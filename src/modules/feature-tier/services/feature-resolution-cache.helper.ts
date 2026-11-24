import type { EncryptedPayload } from '@/common/crypto';
import type { TenantAuthFeatureConfigRow } from '@/database/schema';
import type { TenantService } from '@/modules/tenant';
import type { IFeatureTierRepository } from '../interfaces/feature-tier-repository.interface';

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

export type CachedTenantFeatureRow = Pick<
  TenantAuthFeatureConfigRow,
  'featureId' | 'enabled' | 'settings' | 'secrets'
>;

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

export async function readCatalogVersion(
  redisClient?: FeatureResolutionRedisClient,
): Promise<number> {
  if (!redisClient?.get) return 0;
  try {
    const raw = await redisClient.get(CATALOG_VERSION_KEY);
    const parsed = raw !== null ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export async function loadTenantRowsWithCache(params: {
  tenantId: string;
  tierId: string;
  repo: IFeatureTierRepository;
  tenantService: TenantService;
  redisClient?: FeatureResolutionRedisClient;
}): Promise<{
  rows: CachedTenantFeatureRow[];
  configVersion: number;
}> {
  const { tenantId, tierId, repo, tenantService, redisClient } = params;
  const cacheKey = `${TENANT_FEATURE_CONFIG_CACHE_PREFIX}${tenantId}`;

  if (redisClient?.get) {
    try {
      const raw = await redisClient.get(cacheKey);
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
    repo.listTenantFeatureConfigs(tenantId),
    tenantService.getTenantById(tenantId).catch(() => null),
  ]);
  const configVersion = tenantRow?.configVersion ?? 1;

  if (redisClient?.set) {
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
      await redisClient.set(
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
