import { describe, expect, it, mock } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { CryptoService, type EncryptedPayload } from '@/common/crypto';
import { BusinessError } from '@/common/errors/business-error';
import type { IFeatureTierRepository } from '../interfaces/feature-tier-repository.interface';
import { FeatureResolutionService } from './feature-resolution.service';
import { TenantFeatureConfigService } from './tenant-feature-config.service';

const TEST_HEX_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createCryptoService(withKey: boolean): CryptoService {
  const configService = {
    get: (key: string) => {
      if (key === 'AUTH_CONFIG_ENCRYPTION_KEY') {
        return withKey ? TEST_HEX_KEY : undefined;
      }
      return undefined;
    },
  } as unknown as ConfigService;
  return new CryptoService(configService);
}

function createMockRepo(
  overrides?: Partial<IFeatureTierRepository>,
): IFeatureTierRepository {
  return {
    listFeatures: mock(() =>
      Promise.resolve([
        {
          id: 'feat-google-uuid',
          code: 'socialGoogle',
          name: 'Google OAuth',
          description: null,
          category: 'social',
          packageName: 'better-auth',
          status: 'active' as const,
          dependencies: [],
          availableSetting: [
            { key: 'clientId', label: 'Client ID', type: 'string' },
            { key: 'clientSecret', label: 'Client Secret', type: 'secret' },
            { key: 'prompt', label: 'Prompt', type: 'string' },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    ),
    findFeatureByIdOrCode: mock((idOrCode: string) => {
      if (idOrCode === 'socialGoogle' || idOrCode === 'feat-google-uuid') {
        return Promise.resolve({
          id: 'feat-google-uuid',
          code: 'socialGoogle',
          name: 'Google OAuth',
          description: null,
          category: 'social',
          packageName: 'better-auth',
          status: 'active' as const,
          dependencies: [],
          availableSetting: [
            { key: 'clientId', label: 'Client ID', type: 'string' },
            { key: 'clientSecret', label: 'Client Secret', type: 'secret' },
            { key: 'prompt', label: 'Prompt', type: 'string' },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return Promise.resolve(null);
    }),
    updateFeatureStatus: mock(() => Promise.resolve(null)),
    listTiersWithFeatures: mock(() => Promise.resolve([])),
    findTierById: mock(() =>
      Promise.resolve({
        id: 'tier_business',
        code: 'business',
        name: 'Business',
        description: null,
        sortOrder: 2,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    getTierFeatureIds: mock(() => Promise.resolve(['feat-google-uuid'])),
    replaceTierFeatures: mock(() => Promise.resolve()),
    listPlatformFeatureConfigs: mock(() => Promise.resolve([])),
    listTenantFeatureConfigs: mock(() => Promise.resolve([])),
    findTenantFeatureConfig: mock(() => Promise.resolve(null)),
    upsertTenantFeatureConfig: mock((input) =>
      Promise.resolve({
        tenantId: input.tenantId,
        featureId: input.featureId,
        enabled: input.enabled,
        settings: input.settings,
        secrets: input.secrets,
        updatedBy: input.updatedBy ?? null,
        updatedAt: new Date(),
      }),
    ),
    bumpTenantConfigVersion: mock(() => Promise.resolve(2)),
    ...overrides,
  };
}

describe('TenantFeatureConfigService (Review Focus #2)', () => {
  it('should reject writing a secret without AUTH_CONFIG_ENCRYPTION_KEY with 400 ENCRYPTION_KEY_MISSING', async () => {
    const repo = createMockRepo();
    const crypto = createCryptoService(false);
    const tenantService = {
      getTenantById: mock(() =>
        Promise.resolve({
          id: 'ten_1',
          tierId: 'tier_business',
          configVersion: 1,
        }),
      ),
    } as any;
    const registry = {
      invalidateTenant: mock(() => Promise.resolve()),
    } as any;

    const service = new TenantFeatureConfigService(
      repo,
      crypto,
      tenantService,
      registry,
    );

    let caught: unknown;
    try {
      await service.updateTenantFeatureConfig(
        'ten_1',
        {
          featureCode: 'socialGoogle',
          enabled: true,
          settings: { clientId: 'cid-123' },
          secrets: { clientSecret: 'super-secret-value' },
        },
        'user_1',
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(400);
    expect((caught as BusinessError).code).toBe('ENCRYPTION_KEY_MISSING');
    expect(repo.upsertTenantFeatureConfig).not.toHaveBeenCalled();
  });

  it('should move secret-typed fields from availableSetting into encrypted secrets column and strip them from settings', async () => {
    let savedInput: any = null;
    const repo = createMockRepo({
      upsertTenantFeatureConfig: mock((input) => {
        savedInput = input;
        return Promise.resolve({
          ...input,
          updatedBy: input.updatedBy ?? null,
          updatedAt: new Date(),
        });
      }),
    });
    const crypto = createCryptoService(true);
    const tenantService = {
      getTenantById: mock(() =>
        Promise.resolve({
          id: 'ten_1',
          tierId: 'tier_business',
          configVersion: 1,
        }),
      ),
    } as any;
    const registry = {
      invalidateTenant: mock(() => Promise.resolve()),
    } as any;

    const service = new TenantFeatureConfigService(
      repo,
      crypto,
      tenantService,
      registry,
    );

    await service.updateTenantFeatureConfig(
      'ten_1',
      {
        featureCode: 'socialGoogle',
        enabled: true,
        settings: {
          clientId: 'cid-123',
          clientSecret: 'leaked-into-settings',
          prompt: 'select_account',
        },
      },
      'user_1',
    );

    expect(savedInput).not.toBeNull();
    expect(savedInput.settings).toEqual({
      clientId: 'cid-123',
      prompt: 'select_account',
    });
    expect(savedInput.settings.clientSecret).toBeUndefined();
    expect(savedInput.secrets.clientSecret).toBeDefined();
    expect(savedInput.secrets.clientSecret.alg).toBe('aes-256-gcm');
    expect(crypto.decryptSecret(savedInput.secrets.clientSecret)).toBe(
      'leaked-into-settings',
    );
  });

  it('should preserve existing ciphertext on empty secret input and GET config only returns secretsConfigured booleans', async () => {
    const crypto = createCryptoService(true);
    const existingCiphertext: EncryptedPayload = crypto.encryptSecret(
      'original-google-secret',
    );

    let savedInput: any = null;
    const repo = createMockRepo({
      findTenantFeatureConfig: mock(() =>
        Promise.resolve({
          tenantId: 'ten_1',
          featureId: 'feat-google-uuid',
          enabled: true,
          settings: { clientId: 'cid-123' },
          secrets: { clientSecret: existingCiphertext },
          updatedBy: 'user_1',
          updatedAt: new Date(),
        }),
      ),
      listTenantFeatureConfigs: mock(() =>
        Promise.resolve([
          {
            tenantId: 'ten_1',
            featureId: 'feat-google-uuid',
            enabled: true,
            settings: { clientId: 'cid-123' },
            secrets: { clientSecret: existingCiphertext },
            updatedBy: 'user_1',
            updatedAt: new Date(),
          },
        ]),
      ),
      upsertTenantFeatureConfig: mock((input) => {
        savedInput = input;
        return Promise.resolve({
          ...input,
          updatedBy: input.updatedBy ?? null,
          updatedAt: new Date(),
        });
      }),
    });

    const tenantService = {
      getTenantById: mock(() =>
        Promise.resolve({
          id: 'ten_1',
          slug: 'pos-amir',
          tierId: 'tier_business',
          configVersion: 1,
        }),
      ),
      invalidateSlugCache: mock(() => Promise.resolve()),
    } as any;
    const registry = {
      invalidateTenant: mock(() => Promise.resolve()),
    } as any;
    const redisClient = {
      del: mock(() => Promise.resolve(1)),
      publish: mock(() => Promise.resolve(1)),
    };

    const service = new TenantFeatureConfigService(
      repo,
      crypto,
      tenantService,
      registry,
      redisClient as any,
    );

    const updated = await service.updateTenantFeatureConfig(
      'ten_1',
      {
        featureCode: 'socialGoogle',
        enabled: true,
        settings: { clientId: 'cid-456' },
        secrets: { clientSecret: '' },
      },
      'user_1',
    );

    expect(updated.allowedInTier).toBe(true);
    expect(redisClient.del).toHaveBeenCalledWith(
      'authcore:tenant:config:ten_1',
    );
    expect(redisClient.del).toHaveBeenCalledWith(
      'authcore:tenant:slug:pos-amir',
    );

    expect(savedInput.secrets.clientSecret).toEqual(existingCiphertext);
    expect(crypto.decryptSecret(savedInput.secrets.clientSecret)).toBe(
      'original-google-secret',
    );

    const list = await service.getTenantFeatureConfigs('ten_1');
    const googleItem = list.find((item) => item.featureCode === 'socialGoogle');
    expect(googleItem).toBeDefined();
    expect(googleItem?.secretsConfigured).toEqual({ clientSecret: true });
    expect((googleItem as any).secrets).toBeUndefined();
    expect(JSON.stringify(googleItem)).not.toContain('original-google-secret');
    expect(JSON.stringify(googleItem)).not.toContain(existingCiphertext.ct);
  });

  it('should compute accurate allowedInTier on disable and reject editing settings/secrets/clearSecretKeys on tier-locked or unavailable features', async () => {
    const crypto = createCryptoService(true);
    const ssoFeature = {
      id: 'feat-sso-uuid',
      code: 'sso',
      name: 'Enterprise SSO',
      description: null,
      category: 'enterprise',
      packageName: '@better-auth/sso',
      status: 'active' as const,
      dependencies: [],
      availableSetting: [
        { key: 'domain', label: 'Domain', type: 'string' as const },
        { key: 'clientSecret', label: 'Secret', type: 'secret' as const },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const repo = createMockRepo({
      findFeatureByIdOrCode: mock(() => Promise.resolve(ssoFeature)),
      getTierFeatureIds: mock(() => Promise.resolve([])), // NOT included in tier_free
    });

    const tenantService = {
      getTenantById: mock(() =>
        Promise.resolve({
          id: 'ten_free',
          slug: 'free-shop',
          tierId: 'tier_free',
          configVersion: 1,
        }),
      ),
      invalidateSlugCache: mock(() => Promise.resolve()),
    } as any;
    const registry = { invalidateTenant: mock(() => Promise.resolve()) } as any;

    const service = new TenantFeatureConfigService(
      repo,
      crypto,
      tenantService,
      registry,
    );

    // 1. Disabling with empty settings/secrets/clearSecretKeys succeeds & reports allowedInTier: false
    const disabledView = await service.updateTenantFeatureConfig('ten_free', {
      featureCode: 'sso',
      enabled: false,
    });
    expect(disabledView.allowedInTier).toBe(false);
    expect(disabledView.enabled).toBe(false);

    // 2. Trying to edit settings, secrets, or clearSecretKeys on locked feature -> 403 FEATURE_TIER_LOCKED
    for (const payload of [
      { featureCode: 'sso', enabled: false, settings: { domain: 'a.com' } },
      { featureCode: 'sso', enabled: false, secrets: { clientSecret: 's' } },
      { featureCode: 'sso', enabled: false, clearSecretKeys: ['clientSecret'] },
    ]) {
      let caught: unknown;
      try {
        await service.updateTenantFeatureConfig('ten_free', payload);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(403);
      expect((caught as BusinessError).code).toBe('FEATURE_TIER_LOCKED');
    }
  });

  it('should NOT inherit process.env.GOOGLE_CLIENT_SECRET in resolveForTenant when tenant ciphertext is empty', async () => {
    const prevGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_SECRET = 'platform-env-google-secret';

    try {
      const crypto = createCryptoService(true);
      const repo = createMockRepo({
        listTenantFeatureConfigs: mock(() =>
          Promise.resolve([
            {
              tenantId: 'ten_1',
              featureId: 'feat-google-uuid',
              enabled: true,
              settings: { clientId: 'tenant-cid' },
              secrets: {},
              updatedBy: 'user_1',
              updatedAt: new Date(),
            },
          ]),
        ),
      });
      const tenantService = {
        getTenantById: mock(() =>
          Promise.resolve({
            id: 'ten_1',
            tierId: 'tier_business',
            configVersion: 1,
          }),
        ),
      } as any;

      const resolution = new FeatureResolutionService(
        repo,
        crypto,
        tenantService,
      );

      const resolved = await resolution.resolveForTenant(
        'ten_1',
        'tier_business',
      );

      expect(resolved.configMap.socialGoogle.enabled).toBe(true);
      expect(resolved.decryptedSecrets.socialGoogle).toBeUndefined();
      expect(JSON.stringify(resolved)).not.toContain(
        'platform-env-google-secret',
      );
    } finally {
      if (prevGoogleSecret === undefined) {
        delete process.env.GOOGLE_CLIENT_SECRET;
      } else {
        process.env.GOOGLE_CLIENT_SECRET = prevGoogleSecret;
      }
    }
  });
});
