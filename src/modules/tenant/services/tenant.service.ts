import * as crypto from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import { CacheService } from '@/common/cache/cache.service';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { BusinessError } from '@/common/errors/business-error';
import {
  RESERVED_TENANT_SLUGS,
  TENANT_REPOSITORY_TOKEN,
  type CreateTenantInput,
  type ITenantRepository,
  type ListTenantsQuery,
  type TenantRow,
  type TenantSummaryCache,
  type UpdateTenantInput,
} from '../interfaces/tenant-repository.interface';

const TENANT_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const TENANT_SLUG_CACHE_PREFIX = 'authcore:tenant:slug:';
const TENANT_SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
const CONFIG_INVALIDATED_CHANNEL = 'authcore:config:invalidated';
const DEFAULT_TIER_ID = 'tier_free';

interface RedisPublishClient {
  publish?: (channel: string, message: string) => Promise<unknown>;
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);
  private readonly reservedSlugSet = new Set<string>(RESERVED_TENANT_SLUGS);

  constructor(
    @Inject(TENANT_REPOSITORY_TOKEN)
    private readonly tenantRepo: ITenantRepository,
    @Optional() private readonly cacheService?: CacheService,
    @Optional()
    @Inject(BETTER_AUTH_REDIS_CLIENT)
    private readonly redisClient?: RedisPublishClient,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  private normalizeAndValidateSlug(rawSlug: string): string {
    const slug = (rawSlug ?? '').trim().toLowerCase();

    if (this.reservedSlugSet.has(slug) || !TENANT_SLUG_REGEX.test(slug)) {
      throw BusinessError.badRequest(
        `Slug tenant '${slug}' tidak valid atau termasuk reserved slug.`,
        'INVALID_TENANT_SLUG',
        { slug },
      );
    }

    return slug;
  }

  private buildSlugCacheKey(slug: string): string {
    return `${TENANT_SLUG_CACHE_PREFIX}${slug}`;
  }

  private toSummaryCache(tenant: TenantRow): TenantSummaryCache {
    return {
      id: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      tierId: tenant.tierId,
      configVersion: tenant.configVersion,
    };
  }

  private async syncSlugCache(tenant: TenantRow): Promise<void> {
    if (!this.cacheService) return;
    try {
      await this.cacheService.set(
        this.buildSlugCacheKey(tenant.slug),
        this.toSummaryCache(tenant),
        TENANT_SLUG_CACHE_TTL_MS,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to sync Redis slug cache for '${tenant.slug}': ${(err as Error).message}`,
      );
    }
  }

  private async publishInvalidation(tenant: TenantRow): Promise<void> {
    const payload = {
      scope: 'tenant' as const,
      tenantId: tenant.id,
      slug: tenant.slug,
      configVersion: tenant.configVersion,
    };

    this.eventEmitter?.emit('tenant.config.invalidated', payload);

    if (!this.redisClient?.publish) return;
    try {
      await this.redisClient.publish(
        CONFIG_INVALIDATED_CHANNEL,
        JSON.stringify(payload),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to publish tenant invalidation for '${tenant.slug}': ${(err as Error).message}`,
      );
    }
  }

  private async ensureTierExists(tierId: string): Promise<void> {
    if (!this.tenantRepo.tierExists) return;
    const exists = await this.tenantRepo.tierExists(tierId);
    if (!exists) {
      throw BusinessError.badRequest(
        `Tier '${tierId}' tidak ditemukan.`,
        'INVALID_TIER',
        { tierId },
      );
    }
  }

  async listTenants(query: ListTenantsQuery): Promise<{
    items: TenantRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const paging = clampZeroBasedPagination(query.page, query.pageSize);
    const { items, total } = await this.tenantRepo.listPaginated({
      page: paging.page,
      pageSize: paging.pageSize,
      search: query.search,
      status: query.status,
      tierId: query.tierId,
      ...(query.ownerUserId !== undefined
        ? { ownerUserId: query.ownerUserId }
        : {}),
    });

    return {
      items,
      total,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async getTenantById(id: string): Promise<TenantRow> {
    const tenant = await this.tenantRepo.findById(id);
    if (!tenant) {
      throw BusinessError.notFound('Tenant', id);
    }
    return tenant;
  }

  async getTenantBySlug(rawSlug: string): Promise<TenantRow> {
    const slug = (rawSlug ?? '').trim().toLowerCase();
    const tenant = await this.tenantRepo.findBySlug(slug);
    if (!tenant) {
      throw BusinessError.notFound('Tenant', slug);
    }
    return tenant;
  }

  async resolveSlugSummary(
    rawSlug: string,
  ): Promise<TenantSummaryCache | null> {
    const slug = (rawSlug ?? '').trim().toLowerCase();
    if (!slug || this.reservedSlugSet.has(slug)) {
      return null;
    }

    const cacheKey = this.buildSlugCacheKey(slug);
    if (this.cacheService) {
      try {
        const cached =
          await this.cacheService.get<TenantSummaryCache>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to read Redis slug cache for '${slug}': ${(err as Error).message}`,
        );
      }
    }

    const tenant = await this.tenantRepo.findBySlug(slug);
    if (!tenant) {
      return null;
    }

    await this.syncSlugCache(tenant);
    return this.toSummaryCache(tenant);
  }

  async createTenant(input: CreateTenantInput): Promise<TenantRow> {
    const slug = this.normalizeAndValidateSlug(input.slug);
    const tierId = input.tierId?.trim() || DEFAULT_TIER_ID;

    const existing = await this.tenantRepo.findBySlug(slug);
    if (existing) {
      throw BusinessError.conflict(
        `Slug tenant '${slug}' sudah digunakan.`,
        'TENANT_SLUG_CONFLICT',
        { slug },
      );
    }

    await this.ensureTierExists(tierId);

    const created = await this.tenantRepo.create({
      id: `ten_${crypto.randomUUID()}`,
      name: input.name.trim(),
      slug,
      ownerUserId: input.ownerUserId,
      tierId,
      status: 'active',
      billingStatus: input.billingStatus ?? 'active',
      configVersion: 1,
    });

    await this.syncSlugCache(created);
    return created;
  }

  async updateTenant(id: string, input: UpdateTenantInput): Promise<TenantRow> {
    if (input.slug !== undefined) {
      throw BusinessError.badRequest(
        'Slug tenant bersifat immutable dan tidak dapat diubah.',
        'TENANT_SLUG_IMMUTABLE',
        { tenantId: id },
      );
    }

    const existing = await this.getTenantById(id);

    if (input.tierId !== undefined) {
      await this.ensureTierExists(input.tierId);
    }

    const patch: Partial<TenantRow> = {};
    if (input.name !== undefined) {
      patch.name = input.name.trim();
    }
    if (input.tierId !== undefined) {
      patch.tierId = input.tierId;
    }
    if (input.status !== undefined) {
      patch.status = input.status;
    }
    if (input.billingStatus !== undefined) {
      patch.billingStatus = input.billingStatus;
    }

    const tierOrStatusChanged =
      (input.tierId !== undefined && input.tierId !== existing.tierId) ||
      (input.status !== undefined && input.status !== existing.status);

    let updated =
      Object.keys(patch).length > 0
        ? await this.tenantRepo.update(id, patch)
        : existing;

    if (tierOrStatusChanged) {
      const nextVersion = await this.tenantRepo.incrementConfigVersion(id);
      updated = { ...updated, configVersion: nextVersion };
      await this.syncSlugCache(updated);
      await this.publishInvalidation(updated);
    } else if (Object.keys(patch).length > 0) {
      await this.syncSlugCache(updated);
    }

    return updated;
  }

  async changeTier(id: string, tierId: string): Promise<TenantRow> {
    return this.updateTenant(id, { tierId });
  }

  async suspendTenant(id: string): Promise<TenantRow> {
    return this.updateTenant(id, { status: 'suspended' });
  }

  async activateTenant(id: string): Promise<TenantRow> {
    return this.updateTenant(id, { status: 'active' });
  }
}
