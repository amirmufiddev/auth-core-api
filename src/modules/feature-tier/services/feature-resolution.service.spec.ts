import { describe, expect, it, mock } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@/common/crypto';
import { BusinessError } from '@/common/errors/business-error';
import type { IFeatureTierRepository } from '../interfaces/feature-tier-repository.interface';
import { FeatureCatalogService } from './feature-catalog.service';
import { FeatureResolutionService } from './feature-resolution.service';
import { TenantFeatureConfigService } from './tenant-feature-config.service';

const TEST_HEX_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createCryptoService(): CryptoService {
  const configService = {
    get: (key: string) =>
      key === 'AUTH_CONFIG_ENCRYPTION_KEY' ? TEST_HEX_KEY : undefined,
  } as unknown as ConfigService;
  return new CryptoService(configService);
}

describe('FeatureResolutionService & FeatureCatalogService (Review Focus #3)', () => {
  it('should reject enabling a feature outside tierId with 403 FEATURE_TIER_LOCKED and disabled/coming_soon with 400 FEATURE_UNAVAILABLE', async () => {
    const crypto = createCryptoService();
    const features = [
      {
        id: 'feat-sso-uuid',
        code: 'sso',
        name: 'Enterprise SSO',
        description: null,
        category: 'enterprise',
        packageName: '@better-auth/sso',
        status: 'active' as const,
        dependencies: [],
        availableSetting: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'feat-scim-uuid',
        code: 'scim',
        name: 'SCIM 2.0',
        description: null,
        category: 'enterprise',
        packageName: '@better-auth/scim',
        status: 'coming_soon' as const,
        dependencies: [],
        availableSetting: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const repo: IFeatureTierRepository = {
      listFeatures: mock(() => Promise.resolve(features)),
      findFeatureByIdOrCode: mock((idOrCode: string) =>
        Promise.resolve(
          features.find((f) => f.code === idOrCode || f.id === idOrCode) ??
            null,
        ),
      ),
      updateFeatureStatus: mock(() => Promise.resolve(null)),
      listTiersWithFeatures: mock(() => Promise.resolve([])),
      findTierById: mock(() =>
        Promise.resolve({
          id: 'tier_free',
          code: 'free',
          name: 'Free',
          description: null,
          sortOrder: 0,
          isDefault: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      getTierFeatureIds: mock(() => Promise.resolve([])), // Free tier does NOT include sso
      replaceTierFeatures: mock(() => Promise.resolve()),
      listPlatformFeatureConfigs: mock(() => Promise.resolve([])),
      listTenantFeatureConfigs: mock(() => Promise.resolve([])),
      findTenantFeatureConfig: mock(() => Promise.resolve(null)),
      upsertTenantFeatureConfig: mock((input) =>
        Promise.resolve({
          ...input,
          updatedBy: null,
          updatedAt: new Date(),
        }),
      ),
      bumpTenantConfigVersion: mock(() => Promise.resolve(2)),
    };

    const tenantService = {
      getTenantById: mock(() =>
        Promise.resolve({
          id: 'ten_free',
          tierId: 'tier_free',
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

    // 1. Outside tierId -> 403 FEATURE_TIER_LOCKED
    let tierErr: unknown;
    try {
      await service.updateTenantFeatureConfig('ten_free', {
        featureCode: 'sso',
        enabled: true,
      });
    } catch (err) {
      tierErr = err;
    }
    expect(tierErr).toBeInstanceOf(BusinessError);
    expect((tierErr as BusinessError).httpStatus).toBe(403);
    expect((tierErr as BusinessError).code).toBe('FEATURE_TIER_LOCKED');

    // 2. coming_soon / disabled -> 400 FEATURE_UNAVAILABLE
    let statusErr: unknown;
    try {
      await service.updateTenantFeatureConfig('ten_free', {
        featureCode: 'scim',
        enabled: true,
      });
    } catch (err) {
      statusErr = err;
    }
    expect(statusErr).toBeInstanceOf(BusinessError);
    expect((statusErr as BusinessError).httpStatus).toBe(400);
    expect((statusErr as BusinessError).code).toBe('FEATURE_UNAVAILABLE');
  });

  it('should call AuthRuntimeRegistry.invalidateCatalog() on feature status or tier matrix mutation without bulk updating tenant rows', async () => {
    const ssoFeature = {
      id: 'feat-sso-uuid',
      code: 'sso',
      name: 'Enterprise SSO',
      description: null,
      category: 'enterprise',
      packageName: '@better-auth/sso',
      status: 'active' as const,
      dependencies: [],
      availableSetting: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const repo: IFeatureTierRepository = {
      listFeatures: mock(() => Promise.resolve([ssoFeature])),
      findFeatureByIdOrCode: mock(() => Promise.resolve(ssoFeature)),
      updateFeatureStatus: mock((_id, status) =>
        Promise.resolve({
          ...ssoFeature,
          status,
        }),
      ),
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
      getTierFeatureIds: mock(() => Promise.resolve(['feat-sso-uuid'])),
      replaceTierFeatures: mock(() => Promise.resolve()),
      listPlatformFeatureConfigs: mock(() => Promise.resolve([])),
      listTenantFeatureConfigs: mock(() => Promise.resolve([])),
      findTenantFeatureConfig: mock(() => Promise.resolve(null)),
      upsertTenantFeatureConfig: mock((input) =>
        Promise.resolve({
          ...input,
          updatedBy: null,
          updatedAt: new Date(),
        }),
      ),
      bumpTenantConfigVersion: mock(() => Promise.resolve(2)),
    };

    const invalidateCatalog = mock(() => Promise.resolve(5));
    const registry = { invalidateCatalog } as any;

    const catalogService = new FeatureCatalogService(repo, registry);

    await catalogService.updateFeatureStatus('feat-sso-uuid', 'disabled');
    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
    expect(repo.bumpTenantConfigVersion).not.toHaveBeenCalled();

    await catalogService.updateTierFeatures('tier_business', ['feat-sso-uuid']);
    expect(invalidateCatalog).toHaveBeenCalledTimes(2);
    expect(repo.bumpTenantConfigVersion).not.toHaveBeenCalled();
  });

  it('should fail closed on downgrade from Business to Free or operator disable while preserving tenant_auth_feature_config row & secrets for re-upgrade', async () => {
    const crypto = createCryptoService();
    const encryptedSecret = crypto.encryptSecret('tenant-sso-secret');

    let featureStatus: 'active' | 'disabled' = 'active';
    const tenantRows = [
      {
        tenantId: 'ten_1',
        featureId: 'feat-sso-uuid',
        enabled: true,
        settings: { domainVerification: true },
        secrets: { clientSecret: encryptedSecret },
        updatedBy: 'owner_1',
        updatedAt: new Date(),
      },
    ];

    const repo: IFeatureTierRepository = {
      listFeatures: mock(() =>
        Promise.resolve([
          {
            id: 'feat-sso-uuid',
            code: 'sso',
            name: 'Enterprise SSO',
            description: null,
            category: 'enterprise',
            packageName: '@better-auth/sso',
            status: featureStatus,
            dependencies: [],
            availableSetting: [
              { key: 'clientSecret', label: 'Client Secret', type: 'secret' },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      ),
      findFeatureByIdOrCode: mock(() => Promise.resolve(null)),
      updateFeatureStatus: mock(() => Promise.resolve(null)),
      listTiersWithFeatures: mock(() => Promise.resolve([])),
      findTierById: mock(() => Promise.resolve(null)),
      getTierFeatureIds: mock((tierId: string) =>
        Promise.resolve(tierId === 'tier_business' ? ['feat-sso-uuid'] : []),
      ),
      replaceTierFeatures: mock(() => Promise.resolve()),
      listPlatformFeatureConfigs: mock(() => Promise.resolve([])),
      listTenantFeatureConfigs: mock(() => Promise.resolve(tenantRows)),
      findTenantFeatureConfig: mock(() => Promise.resolve(tenantRows[0])),
      upsertTenantFeatureConfig: mock((input) =>
        Promise.resolve({
          ...input,
          updatedBy: null,
          updatedAt: new Date(),
        }),
      ),
      bumpTenantConfigVersion: mock(() => Promise.resolve(2)),
    };

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

    // 1. Active on Business tier -> enabled: true + decrypted secret available
    const businessResolved = await resolution.resolveForTenant(
      'ten_1',
      'tier_business',
    );
    expect(businessResolved.configMap.sso.enabled).toBe(true);
    expect(businessResolved.decryptedSecrets.sso?.clientSecret).toBe(
      'tenant-sso-secret',
    );

    // 2. Downgrade to Free tier -> fail-closed (enabled: false), row & secrets preserved
    const freeResolved = await resolution.resolveForTenant(
      'ten_1',
      'tier_free',
    );
    expect(freeResolved.configMap.sso.enabled).toBe(false);
    expect(freeResolved.decryptedSecrets.sso).toBeUndefined();
    expect(tenantRows[0].enabled).toBe(true);
    expect(tenantRows[0].secrets.clientSecret).toEqual(encryptedSecret);

    // 3. Upgrade back to Business -> re-enabled with preserved secret
    const reUpgraded = await resolution.resolveForTenant(
      'ten_1',
      'tier_business',
    );
    expect(reUpgraded.configMap.sso.enabled).toBe(true);
    expect(reUpgraded.decryptedSecrets.sso?.clientSecret).toBe(
      'tenant-sso-secret',
    );

    // 4. Operator disables feature -> fail-closed even on Business tier
    featureStatus = 'disabled';
    const operatorDisabled = await resolution.resolveForTenant(
      'ten_1',
      'tier_business',
    );
    expect(operatorDisabled.configMap.sso.enabled).toBe(false);
    expect(operatorDisabled.decryptedSecrets.sso).toBeUndefined();
  });
});
