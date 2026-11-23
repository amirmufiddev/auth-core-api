import type { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  TenantRow,
  TenantSummaryCache,
} from '../interfaces/tenant-repository.interface';

export const TENANT_SLUG_CACHE_PREFIX = 'authcore:tenant:slug:';
export const TENANT_SLUG_CACHE_TTL_SECONDS = 300;
export const CONFIG_INVALIDATED_CHANNEL = 'authcore:config:invalidated';

export interface TenantRedisClient {
  get?: (key: string) => Promise<string | null>;
  set?: (
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
  ) => Promise<unknown>;
  del?: (...keys: string[]) => Promise<unknown>;
  publish?: (channel: string, message: string) => Promise<unknown>;
}

export function buildTenantSlugCacheKey(slug: string): string {
  return `${TENANT_SLUG_CACHE_PREFIX}${slug}`;
}

export function toTenantSummaryCache(tenant: TenantRow): TenantSummaryCache {
  return {
    id: tenant.id,
    slug: tenant.slug,
    status: tenant.status,
    tierId: tenant.tierId,
    configVersion: tenant.configVersion,
  };
}

export async function readTenantSlugCache(
  redisClient: TenantRedisClient | undefined,
  slug: string,
  logger: Logger,
): Promise<TenantSummaryCache | null> {
  if (!redisClient?.get) return null;
  try {
    const raw = await redisClient.get(buildTenantSlugCacheKey(slug));
    return raw ? (JSON.parse(raw) as TenantSummaryCache) : null;
  } catch (err) {
    logger.warn(
      `Failed to read Redis slug cache for '${slug}': ${(err as Error).message}`,
    );
    return null;
  }
}

export async function writeTenantSlugCache(
  redisClient: TenantRedisClient | undefined,
  tenant: TenantRow,
  logger: Logger,
): Promise<void> {
  if (!redisClient?.set) return;
  try {
    await redisClient.set(
      buildTenantSlugCacheKey(tenant.slug),
      JSON.stringify(toTenantSummaryCache(tenant)),
      'EX',
      TENANT_SLUG_CACHE_TTL_SECONDS,
    );
  } catch (err) {
    logger.warn(
      `Failed to sync Redis slug cache for '${tenant.slug}': ${(err as Error).message}`,
    );
  }
}

export async function publishTenantInvalidation(
  redisClient: TenantRedisClient | undefined,
  eventEmitter: EventEmitter2 | undefined,
  tenant: TenantRow,
  logger: Logger,
): Promise<void> {
  const payload = {
    scope: 'tenant' as const,
    tenantId: tenant.id,
    slug: tenant.slug,
    configVersion: tenant.configVersion,
  };

  eventEmitter?.emit('tenant.config.invalidated', payload);

  if (!redisClient?.publish) return;
  try {
    await redisClient.publish(
      CONFIG_INVALIDATED_CHANNEL,
      JSON.stringify(payload),
    );
  } catch (err) {
    logger.warn(
      `Failed to publish tenant invalidation for '${tenant.slug}': ${(err as Error).message}`,
    );
  }
}
