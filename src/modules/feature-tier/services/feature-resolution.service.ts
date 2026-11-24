import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import { CryptoService, type EncryptedPayload } from '@/common/crypto';
import type { AuthFeature, TenantAuthFeatureConfigRow } from '@/database/schema';
import {
  BETTER_AUTH_FEATURE_CATALOG,
  BETTER_AUTH_FEATURE_CATALOG_MAP,
  type BetterAuthFeatureId,
  type FeatureConfigMap,
  buildDefaultFeatureConfigFromEnv,
  sanitizeFeatureConfigForPublic,
} from '@/modules/auth';
import { TenantService } from '@/modules/tenant';
import {
  FEATURE_TIER_REPOSITORY_TOKEN,
  type IFeatureTierRepository,
} from '../interfaces/feature-tier-repository.interface';

export const TENANT_FEATURE_CONFIG_CACHE_PREFIX = 'authcore:tenant:config:';
export const TENANT_FEATURE_CONFIG_CACHE_TTL_SECONDS = 300;
export const CATALOG_VERSION_KEY = 'authcore:catalog:version';

export interface FeatureResolutionRedisClient {
  get?: (key: string) => Promise<string | null>;
  set?: (
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
  ) => Promise<unknown>;
  del?: (...keys: string[]) => Promise<unknown>;
}

export interface ResolvedTenantFeatureRuntime {
  configMap: FeatureConfigMap;
  decryptedSecrets: Partial<
    Record<BetterAuthFeatureId, Record<string, string>>
  >;
  configVersion: number;
  catalogVersion: number;
}

export interface PublicAuthConfigResponse {
  features: FeatureConfigMap;
  capabilities: Record<
    BetterAuthFeatureId,
    { available: boolean; reason?: string; packageName: string }
  >;
}

interface CachedTenantConfigPayload {
  tenantId: string;
  tierId: string;
  configVersion: number;
  rows: Array<{
    featureId: string;
    enabled: boolean;
    settings: Record<string, string | number | boolean>;
    secrets: Record<string, EncryptedPayload>;
  }>;
}

@Injectable()
export class FeatureResolutionService {
  private readonly logger = new Logger(FeatureResolutionService.name);

  constructor(
    @Inject(FEATURE_TIER_REPOSITORY_TOKEN)
    private readonly repo: IFeatureTierRepository,
    private readonly cryptoService: CryptoService,
    private readonly tenantService: TenantService,
    @Optional()
    @Inject(BETTER_AUTH_REDIS_CLIENT)
    private readonly redisClient?: FeatureResolutionRedisClient,
  ) {}

  private async readCatalogVersion(): Promise<number> {
    if (!this.redisClient?.get) return 0;
    try {
      const raw = await this.redisClient.get(CATALOG_VERSION_KEY);
      const parsed = raw !== null ? Number(raw) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private decryptSecretMap(
    secrets: Record<string, EncryptedPayload> | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    if (!secrets) return result;
    for (const [key, payload] of Object.entries(secrets)) {
      if (!payload || typeof payload !== 'object') continue;
      try {
        const plain = this.cryptoService.decryptSecret(payload);
        if (plain.length > 0) {
          result[key] = plain;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to decrypt secret '${key}': ${(err as Error).message}`,
        );
      }
    }
    return result;
  }

  async resolveForPlatform(): Promise<ResolvedTenantFeatureRuntime> {
    const base = buildDefaultFeatureConfigFromEnv();
    const [features, platformRows, catalogVersion] = await Promise.all([
      this.repo.listFeatures(),
      this.repo.listPlatformFeatureConfigs(),
      this.readCatalogVersion(),
    ]);

    const featureById = new Map(features.map((f) => [f.id, f]));
    const featureByCode = new Map(features.map((f) => [f.code, f]));
    const platformByFeatureId = new Map(
      platformRows.map((r) => [r.featureId, r]),
    );

    const configMap = {} as FeatureConfigMap;
    const decryptedSecrets: Partial<
      Record<BetterAuthFeatureId, Record<string, string>>
    > = {};

    for (const item of BETTER_AUTH_FEATURE_CATALOG) {
      const dbFeature = featureByCode.get(item.id);
      const isActive =
        item.available && (!dbFeature || dbFeature.status === 'active');
      const platformRow = dbFeature
        ? platformByFeatureId.get(dbFeature.id)
        : undefined;

      const enabled = isActive
        ? (platformRow?.enabled ?? base[item.id].enabled)
        : false;

      configMap[item.id] = {
        enabled,
        settings: {
          ...base[item.id].settings,
          ...(platformRow?.settings ?? {}),
        },
      };

      if (enabled && platformRow?.secrets) {
        const decrypted = this.decryptSecretMap(platformRow.secrets);
        if (Object.keys(decrypted).length > 0) {
          decryptedSecrets[item.id] = decrypted;
        }
      }
    }

    // Enforce dependencies only when target dependency is also active
    for (const item of BETTER_AUTH_FEATURE_CATALOG) {
      if (configMap[item.id].enabled && item.dependencies?.length) {
        for (const dep of item.dependencies) {
          const depFeature = featureByCode.get(dep);
          const depActive =
            BETTER_AUTH_FEATURE_CATALOG_MAP[dep]?.available &&
            (!depFeature || depFeature.status === 'active');
          if (depActive) {
            configMap[dep].enabled = true;
          }
        }
      }
    }

    void featureById;
    return {
      configMap,
      decryptedSecrets,
      configVersion: 1,
      catalogVersion,
    };
  }

  private async loadTenantRowsWithCache(
    tenantId: string,
    tierId: string,
  ): Promise<{
    rows: Array<
      Pick<
        TenantAuthFeatureConfigRow,
        'featureId' | 'enabled' | 'settings' | 'secrets'
      >
    >;
    configVersion: number;
  }> {
    const cacheKey = `${TENANT_FEATURE_CONFIG_CACHE_PREFIX}${tenantId}`;
    if (this.redisClient?.get) {
      try {
        const raw = await this.redisClient.get(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as CachedTenantConfigPayload;
          if (parsed.tierId === tierId && Array.isArray(parsed.rows)) {
            return {
              rows: parsed.rows,
              configVersion: parsed.configVersion ?? 1,
            };
          }
        }
      } catch {
        // Fallback to DB on cache read error
      }
    }

    const [rows, tenantRow] = await Promise.all([
      this.repo.listTenantFeatureConfigs(tenantId),
      this.tenantService.getTenantById(tenantId).catch(() => null),
    ]);
    const configVersion = tenantRow?.configVersion ?? 1;

    if (this.redisClient?.set) {
      try {
        const payload: CachedTenantConfigPayload = {
          tenantId,
          tierId,
          configVersion,
          rows: rows.map((r) => ({
            featureId: r.featureId,
            enabled: r.enabled,
            settings: r.settings ?? {},
            secrets: r.secrets ?? {},
          })),
        };
        await this.redisClient.set(
          cacheKey,
          JSON.stringify(payload),
          'EX',
          TENANT_FEATURE_CONFIG_CACHE_TTL_SECONDS,
        );
      } catch {
        // Best-effort cache write
      }
    }

    return { rows, configVersion };
  }

  async resolveForTenant(
    tenantId: string,
    tierId: string,
  ): Promise<ResolvedTenantFeatureRuntime> {
    const [features, tierFeatureIds, tenantData, catalogVersion] =
      await Promise.all([
        this.repo.listFeatures(),
        this.repo.getTierFeatureIds(tierId),
        this.loadTenantRowsWithCache(tenantId, tierId),
        this.readCatalogVersion(),
      ]);

    const featureByCode = new Map<string, AuthFeature>(
      features.map((f) => [f.code, f]),
    );
    const allowedFeatureIds = new Set(tierFeatureIds);
    const tenantRowByFeatureId = new Map(
      tenantData.rows.map((r) => [r.featureId, r]),
    );

    const configMap = {} as FeatureConfigMap;
    const decryptedSecrets: Partial<
      Record<BetterAuthFeatureId, Record<string, string>>
    > = {};

    for (const item of BETTER_AUTH_FEATURE_CATALOG) {
      const dbFeature = featureByCode.get(item.id);
      const isActive =
        item.available && (!dbFeature || dbFeature.status === 'active');
      const isAllowedInTier = dbFeature
        ? allowedFeatureIds.has(dbFeature.id)
        : false;
      const tenantRow = dbFeature
        ? tenantRowByFeatureId.get(dbFeature.id)
        : undefined;

      // Fail-closed: disabled/coming_soon or outside tierId => enabled: false
      const enabled =
        isActive && isAllowedInTier
          ? (tenantRow?.enabled ?? item.defaultEnabled)
          : false;

      configMap[item.id] = {
        enabled,
        settings: {
          ...item.defaultSettings,
          ...(tenantRow?.settings ?? {}),
        },
      };

      // Secret isolation: ONLY decrypt tenant's own ciphertext when enabled
      if (enabled && tenantRow?.secrets) {
        const decrypted = this.decryptSecretMap(tenantRow.secrets);
        if (Object.keys(decrypted).length > 0) {
          decryptedSecrets[item.id] = decrypted;
        }
      }
    }

    // Dependencies: only auto-enable if dependency is ALSO active & allowed in tier
    for (const item of BETTER_AUTH_FEATURE_CATALOG) {
      if (configMap[item.id].enabled && item.dependencies?.length) {
        for (const dep of item.dependencies) {
          const depFeature = featureByCode.get(dep);
          const depActive =
            BETTER_AUTH_FEATURE_CATALOG_MAP[dep]?.available &&
            (!depFeature || depFeature.status === 'active');
          const depAllowed = depFeature
            ? allowedFeatureIds.has(depFeature.id)
            : false;
          if (depActive && depAllowed) {
            configMap[dep].enabled = true;
          }
        }
      }
    }

    return {
      configMap,
      decryptedSecrets,
      configVersion: tenantData.configVersion,
      catalogVersion,
    };
  }

  async getPublicCapabilitiesForTenant(
    tenantId: string,
  ): Promise<PublicAuthConfigResponse> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    const resolved = await this.resolveForTenant(tenantId, tenant.tierId);

    const capabilities = Object.fromEntries(
      BETTER_AUTH_FEATURE_CATALOG.map((item) => [
        item.id,
        {
          available: item.available && resolved.configMap[item.id].enabled,
          ...(item.unavailableReason ? { reason: item.unavailableReason } : {}),
          packageName: item.packageName,
        },
      ]),
    ) as Record<
      BetterAuthFeatureId,
      { available: boolean; reason?: string; packageName: string }
    >;

    return {
      features: sanitizeFeatureConfigForPublic(resolved.configMap),
      capabilities,
    };
  }
}
