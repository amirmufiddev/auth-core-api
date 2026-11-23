import { describe, expect, it, mock } from 'bun:test';
import { BusinessError } from '@/common/errors/business-error';
import type { Tenant } from '@/database/schema';
import {
  RESERVED_TENANT_SLUGS,
  type ITenantRepository,
  type TenantSummaryCache,
} from '../interfaces/tenant-repository.interface';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
  const makeTenantRow = (overrides: Partial<Tenant> = {}): Tenant => ({
    id: 'ten_1',
    name: 'Acme Corp',
    slug: 'acme',
    ownerUserId: 'usr_1',
    tierId: 'tier_free',
    status: 'active',
    billingStatus: 'active',
    configVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  const createMocks = () => {
    const tenantRepo: ITenantRepository = {
      findById: mock(() => Promise.resolve(makeTenantRow())),
      findBySlug: mock(() => Promise.resolve(null)),
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      create: mock((data) =>
        Promise.resolve(
          makeTenantRow({
            id: data.id,
            name: data.name,
            slug: data.slug,
            ownerUserId: data.ownerUserId,
            tierId: data.tierId,
            status: data.status ?? 'active',
            billingStatus: data.billingStatus ?? 'active',
            configVersion: data.configVersion ?? 1,
          }),
        ),
      ),
      update: mock((_id, patch) => Promise.resolve(makeTenantRow(patch))),
      incrementConfigVersion: mock(() => Promise.resolve(2)),
      tierExists: mock(() => Promise.resolve(true)),
    };

    const cacheService = {
      get: mock(() => Promise.resolve(undefined)),
      set: mock(() => Promise.resolve(undefined)),
      del: mock(() => Promise.resolve(undefined)),
    } as any;

    const redisClient = {
      publish: mock(() => Promise.resolve(1)),
    } as any;

    const eventEmitter = {
      emit: mock(() => true),
    } as any;

    return { tenantRepo, cacheService, redisClient, eventEmitter };
  };

  it('should reject all 15 reserved tenant slugs with 400 INVALID_TENANT_SLUG', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    expect(RESERVED_TENANT_SLUGS).toHaveLength(15);

    for (const reservedSlug of RESERVED_TENANT_SLUGS) {
      let caught: unknown;
      try {
        await service.createTenant({
          name: 'Reserved Org',
          slug: reservedSlug,
          ownerUserId: 'usr_1',
          tierId: 'tier_free',
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(400);
      expect((caught as BusinessError).code).toBe('INVALID_TENANT_SLUG');
    }

    expect(mocks.tenantRepo.create).not.toHaveBeenCalled();
  });

  it('should reject uppercase reserved slug and malformed slugs with 400 INVALID_TENANT_SLUG', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    for (const badSlug of [
      'ADMIN',
      'a',
      '-acme',
      'acme-',
      'acme_corp',
      'acme corp',
    ]) {
      let caught: unknown;
      try {
        await service.createTenant({
          name: 'Bad Org',
          slug: badSlug,
          ownerUserId: 'usr_1',
          tierId: 'tier_free',
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(400);
      expect((caught as BusinessError).code).toBe('INVALID_TENANT_SLUG');
    }
  });

  it('should normalize valid slug to lowercase and populate Redis slug cache on createTenant', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const created = await service.createTenant({
      name: 'Acme Corp',
      slug: '  Acme-Corp ',
      ownerUserId: 'usr_1',
      tierId: 'tier_free',
    });

    expect(created.slug).toBe('acme-corp');
    expect(mocks.cacheService.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme-corp',
      {
        id: created.id,
        slug: 'acme-corp',
        status: 'active',
        tierId: 'tier_free',
        configVersion: 1,
      } satisfies TenantSummaryCache,
      300_000,
    );
  });

  it('should reject attempt to change slug on updateTenant with 400 TENANT_SLUG_IMMUTABLE', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    let caught: unknown;
    try {
      await service.updateTenant('ten_1', {
        name: 'New Name',
        slug: 'new-slug',
      } as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(400);
    expect((caught as BusinessError).code).toBe('TENANT_SLUG_IMMUTABLE');
    expect(mocks.tenantRepo.update).not.toHaveBeenCalled();
  });

  it('should update Redis slug cache, increment configVersion, and publish invalidation when tier changes', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      tierId: 'tier_business',
    });

    expect(mocks.tenantRepo.incrementConfigVersion).toHaveBeenCalledWith(
      'ten_1',
    );
    expect(updated.configVersion).toBe(2);
    expect(updated.tierId).toBe('tier_business');
    expect(mocks.cacheService.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme',
      {
        id: 'ten_1',
        slug: 'acme',
        status: 'active',
        tierId: 'tier_business',
        configVersion: 2,
      } satisfies TenantSummaryCache,
      300_000,
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledTimes(1);
    expect(mocks.eventEmitter.emit).toHaveBeenCalledWith(
      'tenant.config.invalidated',
      expect.objectContaining({
        tenantId: 'ten_1',
        slug: 'acme',
        configVersion: 2,
      }),
    );
  });

  it('should update Redis slug cache and increment configVersion when status changes to suspended', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      status: 'suspended',
    });

    expect(mocks.tenantRepo.incrementConfigVersion).toHaveBeenCalledWith(
      'ten_1',
    );
    expect(updated.status).toBe('suspended');
    expect(updated.configVersion).toBe(2);
    expect(mocks.cacheService.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme',
      {
        id: 'ten_1',
        slug: 'acme',
        status: 'suspended',
        tierId: 'tier_free',
        configVersion: 2,
      } satisfies TenantSummaryCache,
      300_000,
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledTimes(1);
  });

  it('should gracefully handle Redis unavailability during cache sync and pubsub invalidation', async () => {
    const mocks = createMocks();
    mocks.cacheService.set = mock(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );
    mocks.redisClient.publish = mock(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );

    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      status: 'suspended',
    });
    expect(updated.status).toBe('suspended');
    expect(updated.configVersion).toBe(2);
  });

  it('should clamp negative page and oversized/negative pageSize on listTenants', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.cacheService,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const resNeg = await service.listTenants({ page: -3, pageSize: -5 });
    expect(resNeg.page).toBe(0);
    expect(resNeg.pageSize).toBe(10);
    expect(mocks.tenantRepo.listPaginated).toHaveBeenCalledWith({
      page: 0,
      pageSize: 10,
      search: undefined,
      status: undefined,
      tierId: undefined,
    });

    const resMax = await service.listTenants({ page: 2, pageSize: 500 });
    expect(resMax.page).toBe(2);
    expect(resMax.pageSize).toBe(100);
  });
});
