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

function createMockRepo(overrides?: Partial<IFeatureTierRepository>): IFeatureTierRepository {
  return {
    listFeatures: mock(async () => [
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
    findFeatureByIdOrCode: mock(async (idOrCode: string) => {
      if (idOrCode === 'socialGoogle' || idOrCode === 'feat-google-uuid') {
        return {
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
        };
      }
      return null;
    }),
    updateFeatureStatus: mock(async () => null),
    listTiersWithFeatures: mock(async () => []),
    findTierById: mock(async () => ({
      id: 'tier_business',
      code: 'business',
      name: 'Business',
      description: null,
      sortOrder: 2,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getTierFeatureIds: mock(async () => ['feat-google-uuid']),
    replaceTierFeatures: mock(async () => {}),
    listPlatformFeatureConfigs: mock(async () => []),
    listTenantFeatureConfigs: mock(async () => []),
    findTenantFeatureConfig: mock(async () => null),
    upsertTenantFeatureConfig: mock(async (input) => ({
      tenantId: input.tenantId,
      featureId: input.featureId,
      enabled: input.enabled,
      settings: input.settings,
      secrets: input.secrets,
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    })),
    bumpTenantConfigVersion: mock(async () => 2),
    ...overrides,
  };
}

describe('TenantFeatureConfigService (Review Focus #2)', () => {
  it('rejects writing a secret without AUTH_CONFIG_ENCRYPTION_KEY with 400 ENCRYPTION_KEY_MISSING', async () => {
    const repo = createMockRepo();
    const crypto = createCryptoService(false);
    const tenantService = {
      getTenantById: mock(async () => ({
        id: 'ten_1',
        tierId: 'tier_business',
        configVersion: 1,
      })),
    } as any;
    const registry = {
      invalidateTenant: mock(async () => {}),
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

  it('moves secret-typed fields from availableSetting into encrypted secrets column and strips them from settings', async () => {
    let savedInput: any = null;
    const repo = createMockRepo({
      upsertTenantFeatureConfig: mock(async (input) => {
        savedInput = input;
        return {
          ...input,
          updatedBy: input.updatedBy ?? null,
          updatedAt: new Date(),
        };
      }),
    });
    const crypto = createCryptoService(true);
    const tenantService = {
      getTenantById: mock(async () => ({
        id: 'ten_1',
        tierId: 'tier_business',
        configVersion: 1,
      })),
    } as any;
    const registry = {
      invalidateTenant: mock(async () => {}),
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

  it('preserves existing ciphertext on empty secret input and GET config only returns secretsConfigured booleans', async () => {
    const crypto = createCryptoService(true);
    const existingCiphertext: EncryptedPayload = crypto.encryptSecret(
      'original-google-secret',
    );

    let savedInput: any = null;
    const repo = createMockRepo({
      findTenantFeatureConfig: mock(async () => ({
        tenantId: 'ten_1',
        featureId: 'feat-google-uuid',
        enabled: true,
        settings: { clientId: 'cid-123' },
        secrets: { clientSecret: existingCiphertext },
        updatedBy: 'user_1',
        updatedAt: new Date(),
      })),
      listTenantFeatureConfigs: mock(async () => [
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
      upsertTenantFeatureConfig: mock(async (input) => {
        savedInput = input;
        return {
          ...input,
          updatedBy: input.updatedBy ?? null,
          updatedAt: new Date(),
        };
      }),
    });

    const tenantService = {
      getTenantById: mock(async () => ({
        id: 'ten_1',
        tierId: 'tier_business',
        configVersion: 1,
      })),
    } as any;
    const registry = {
      invalidateTenant: mock(async () => {}),
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
        settings: { clientId: 'cid-456' },
        secrets: { clientSecret: '' },
      },
      'user_1',
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

  it('resolveForTenant does NOT inherit process.env.GOOGLE_CLIENT_SECRET when tenant ciphertext is empty', async () => {
    const prevGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_SECRET = 'platform-env-google-secret';

    try {
      const crypto = createCryptoService(true);
      const repo = createMockRepo({
        listTenantFeatureConfigs: mock(async () => [
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
      });
      const tenantService = {
        getTenantById: mock(async () => ({
          id: 'ten_1',
          tierId: 'tier_business',
          configVersion: 1,
        })),
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
