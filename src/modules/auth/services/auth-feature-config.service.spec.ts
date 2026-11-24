import { describe, expect, it, mock } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@/common/crypto';
import * as schema from '@/database/schema';
import { AuthFeatureConfigService } from './auth-feature-config.service';
import { BETTER_AUTH_FEATURE_CATALOG } from '../config/feature-catalog';

const TEST_HEX_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createCryptoService(): CryptoService {
  const configService = {
    get: (key: string) =>
      key === 'AUTH_CONFIG_ENCRYPTION_KEY' ? TEST_HEX_KEY : undefined,
  } as unknown as ConfigService;
  return new CryptoService(configService);
}

describe('AuthFeatureConfigService', () => {
  const createMockLogger = () =>
    ({
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    }) as any;

  it('should load defaults from env when database table is empty', async () => {
    const dbMock = {
      select: () => ({
        from: () => ({
          innerJoin: () => Promise.resolve([]),
        }),
      }),
    } as any;

    const service = new AuthFeatureConfigService(dbMock, createMockLogger());
    const config = await service.loadFromDatabase();

    expect(Object.keys(config).length).toBe(BETTER_AUTH_FEATURE_CATALOG.length);
    expect(config.autumn.enabled).toBe(false);
    expect(config.emailAndPassword.enabled).toBe(true);
  });

  it('should join auth_features UUID FKs on loadFromDatabase and decrypt secrets only for enabled features', async () => {
    const crypto = createCryptoService();
    const googleEncrypted = crypto.encryptSecret('google-client-secret-123');
    const githubEncrypted = crypto.encryptSecret('github-client-secret-456');

    const dbMock = {
      select: () => ({
        from: () => ({
          innerJoin: () =>
            Promise.resolve([
              {
                featureId: 'uuid-social-google',
                featureCode: 'socialGoogle',
                enabled: true,
                settings: {
                  clientId: 'google-client-id',
                  clientSecret: 'leaked-if-not-stripped',
                },
                secrets: { clientSecret: googleEncrypted },
                availableSetting: [
                  {
                    key: 'clientId',
                    label: 'Client ID',
                    type: 'string',
                    required: true,
                  },
                  {
                    key: 'clientSecret',
                    label: 'Client Secret',
                    type: 'secret',
                    required: true,
                  },
                ],
              },
              {
                featureId: 'uuid-social-github',
                featureCode: 'socialGithub',
                enabled: false,
                settings: { clientId: 'github-client-id' },
                secrets: { clientSecret: githubEncrypted },
                availableSetting: [],
              },
            ]),
        }),
      }),
    } as any;

    const service = new AuthFeatureConfigService(
      dbMock,
      createMockLogger(),
      crypto,
    );
    const loaded = await service.loadFromDatabase();

    expect(loaded.socialGoogle.enabled).toBe(true);
    expect(loaded.socialGoogle.settings.clientId).toBe('google-client-id');
    expect(loaded.socialGoogle.settings).not.toHaveProperty('clientSecret');

    const decrypted = service.getDecryptedSecrets();
    expect(decrypted.socialGoogle?.clientSecret).toBe(
      'google-client-secret-123',
    );
    expect(decrypted.socialGithub).toBeUndefined();

    const publicCfg = service.getPublicConfig();
    expect(publicCfg.features.socialGoogle.secretsConfigured).toEqual({
      clientSecret: true,
    });
    expect(publicCfg.features.socialGoogle.settings).not.toHaveProperty(
      'clientSecret',
    );
  });

  it('should map code to auth_features UUID FK, encrypt secrets via CryptoService, preserve on blank, and handle clearSecretKeys', async () => {
    const crypto = createCryptoService();
    const featureRows = BETTER_AUTH_FEATURE_CATALOG.map((item, idx) => ({
      id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      code: item.id,
      availableSetting: item.availableSetting,
    }));
    const existingRows: Array<Record<string, unknown>> = [];
    const txValues: Array<Record<string, unknown>> = [];

    const dbMock = {
      select: () => ({
        from: () => ({
          innerJoin: () => Promise.resolve([]),
        }),
      }),
      transaction: async (cb: (tx: any) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: (table: unknown) => {
              if (table === schema.authFeatures) {
                return Promise.resolve(featureRows);
              }
              return Promise.resolve(existingRows);
            },
          }),
          insert: () => ({
            values: (val: Record<string, unknown>) => {
              txValues.push(val);
              return {
                onConflictDoUpdate: () => Promise.resolve(),
              };
            },
          }),
        };
        return cb(tx);
      },
    } as any;

    const service = new AuthFeatureConfigService(
      dbMock,
      createMockLogger(),
      crypto,
    );
    await service.loadFromDatabase();

    const listener = mock(() => {});
    service.onConfigUpdated(listener);

    // 1. Save socialGoogle with clientId in settings & clientSecret in secrets + auto-enable scim deps
    const updated = await service.updateConfig(
      {
        scim: { enabled: true },
        sso: { enabled: false },
        organization: { enabled: false },
        socialGoogle: {
          enabled: true,
          settings: {
            clientId: 'goog-id-1',
            // Even if accidentally placed in settings, secret key is extracted & encrypted
            clientSecret: 'plaintext-moved-to-secrets',
          },
          secrets: {
            clientSecret: 'real-super-secret',
          },
        },
      },
      'admin@authcore.io',
    );

    expect(updated.scim.enabled).toBe(true);
    expect(updated.sso.enabled).toBe(true);
    expect(updated.organization.enabled).toBe(true);
    expect(txValues.length).toBe(BETTER_AUTH_FEATURE_CATALOG.length);
    expect(listener).toHaveBeenCalledTimes(1);

    const googleFeatureUuid = featureRows.find(
      (f) => f.code === 'socialGoogle',
    )!.id;
    const savedGoogleRow = txValues.find(
      (r) => r.featureId === googleFeatureUuid,
    );
    expect(savedGoogleRow).toBeDefined();
    expect(savedGoogleRow?.settings).toEqual({
      clientId: 'goog-id-1',
      prompt: 'select_account',
    });
    const encryptedSecrets = savedGoogleRow?.secrets as Record<string, any>;
    expect(encryptedSecrets.clientSecret).toBeDefined();
    expect(encryptedSecrets.clientSecret.ciphertext).not.toBe(
      'real-super-secret',
    );
    expect(crypto.decryptSecret(encryptedSecrets.clientSecret)).toBe(
      'real-super-secret',
    );
    expect(service.getDecryptedSecrets().socialGoogle?.clientSecret).toBe(
      'real-super-secret',
    );

    // 2. Subsequent update with empty secret preserves existing ciphertext
    txValues.length = 0;
    await service.updateConfig({
      socialGoogle: {
        enabled: true,
        settings: { clientId: 'goog-id-2' },
        secrets: { clientSecret: '' },
      },
    });
    expect(service.getDecryptedSecrets().socialGoogle?.clientSecret).toBe(
      'real-super-secret',
    );

    // 3. Explicit clearSecretKeys deletes secret
    txValues.length = 0;
    await service.updateConfig({
      socialGoogle: {
        enabled: true,
        clearSecretKeys: ['clientSecret'],
      },
    });
    expect(service.getDecryptedSecrets().socialGoogle).toBeUndefined();
    expect(
      service.getPublicConfig().features.socialGoogle.secretsConfigured,
    ).toEqual({ clientSecret: false });
  });

  it('should throw ForbiddenException when asserting a disabled feature', async () => {
    const dbMock = {
      select: () => ({
        from: () => ({
          innerJoin: () => Promise.resolve([]),
        }),
      }),
    } as any;

    const service = new AuthFeatureConfigService(dbMock, createMockLogger());
    await service.loadFromDatabase();

    expect(() => service.assertFeatureEnabled('autumn')).toThrow(
      ForbiddenException,
    );
  });

  it('should preserve explicit non-secret password and token settings in public config while hiding secrets', async () => {
    const dbMock = {
      select: () => ({
        from: () => ({
          innerJoin: () => Promise.resolve([]),
        }),
      }),
    } as any;

    const service = new AuthFeatureConfigService(dbMock, createMockLogger());
    await service.loadFromDatabase();

    const { features } = service.getPublicConfig();
    expect(features.emailAndPassword.settings.minPasswordLength).toBe(8);
    expect(features.emailAndPassword.settings.maxPasswordLength).toBe(128);
    expect(features.agentAuth.settings.tokenTTL).toBe(1800);
    expect(features.oauthProvider.settings.accessTokenExpiresIn).toBe(3600);
    expect(features.oauthProvider.settings.refreshTokenExpiresIn).toBe(2592000);
    expect(features.scim.settings.storeSCIMToken).toBe('hashed');
    expect(
      features.haveIBeenPwned.settings.customPasswordCompromisedMessage,
    ).toBe('Kata sandi terdeteksi dalam kebocoran data publik.');
  });
});
