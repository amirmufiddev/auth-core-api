import * as crypto from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { BusinessError } from '@/common/errors/business-error';
import {
  TENANT_REPOSITORY_TOKEN,
  type CreateTenantInput,
  type ITenantRepository,
  type ListTenantsQuery,
  type TenantRow,
  type TenantSummaryCache,
  type UpdateTenantInput,
} from '../interfaces/tenant-repository.interface';
import {
  buildTenantSlugCacheKey,
  publishTenantInvalidation,
  readTenantSlugCache,
  toTenantSummaryCache,
  writeTenantSlugCache,
  type TenantRedisClient,
} from '../utils/tenant-cache.util';
import {
  isReservedTenantSlug,
  mapTenantCreatePgError,
  normalizeAndValidateTenantSlug,
} from '../utils/tenant-validation.util';
import { seedOrganizationCatalogForTenant } from '@/database/seeds/rbac.seed';
import { DRIZZLE } from '@/database/database.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/database/schema';

const DEFAULT_TIER_ID = 'tier_free';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @Inject(TENANT_REPOSITORY_TOKEN)
    private readonly tenantRepo: ITenantRepository,
    @Optional()
    @Inject(BETTER_AUTH_REDIS_CLIENT)
    private readonly redisClient?: TenantRedisClient,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional()
    @Inject(DRIZZLE)
    private readonly db?: NodePgDatabase<typeof schema>,
  ) {}

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
    if (!slug || isReservedTenantSlug(slug)) {
      return null;
    }

    const cached = await readTenantSlugCache(
      this.redisClient,
      slug,
      this.logger,
    );
    if (cached) {
      return cached;
    }

    const tenant = await this.tenantRepo.findBySlug(slug);
    if (!tenant) {
      return null;
    }

    await writeTenantSlugCache(this.redisClient, tenant, this.logger);
    return toTenantSummaryCache(tenant);
  }

  async createTenant(input: CreateTenantInput): Promise<TenantRow> {
    const slug = normalizeAndValidateTenantSlug(input.slug);
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

    let created: TenantRow;
    try {
      created = await this.tenantRepo.create({
        id: `ten_${crypto.randomUUID()}`,
        name: input.name.trim(),
        slug,
        ownerUserId: input.ownerUserId,
        tierId,
        status: 'active',
        billingStatus: input.billingStatus ?? 'active',
        configVersion: 1,
      });
    } catch (err) {
      mapTenantCreatePgError(err, slug, tierId, input.ownerUserId);
    }

    await writeTenantSlugCache(this.redisClient, created, this.logger);
    if (this.db) {
      await seedOrganizationCatalogForTenant(this.db, created.id);
    }
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

    const updated =
      Object.keys(patch).length > 0
        ? await this.tenantRepo.update(id, patch, {
            bumpConfigVersion: tierOrStatusChanged,
          })
        : existing;

    if (tierOrStatusChanged) {
      await writeTenantSlugCache(this.redisClient, updated, this.logger);
      await publishTenantInvalidation(
        this.redisClient,
        this.eventEmitter,
        updated,
        this.logger,
      );
    } else if (Object.keys(patch).length > 0) {
      await writeTenantSlugCache(this.redisClient, updated, this.logger);
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

  async invalidateSlugCache(rawSlug: string): Promise<void> {
    const slug = (rawSlug ?? '').trim().toLowerCase();
    if (!slug || !this.redisClient?.del) return;
    try {
      await this.redisClient.del(buildTenantSlugCacheKey(slug));
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate Redis slug cache for '${slug}': ${(err as Error).message}`,
      );
    }
  }
}
