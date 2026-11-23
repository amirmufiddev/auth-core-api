import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, mock } from 'bun:test';
import { BusinessError } from '@/common/errors/business-error';
import type { Tenant } from '@/database/schema';
import { UpdateTenantDto } from '../dto/tenant.dto';
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
      update: mock((_id, patch, options) =>
        Promise.resolve(
          makeTenantRow({
            ...patch,
            configVersion: options?.bumpConfigVersion ? 2 : 1,
          }),
        ),
      ),
      incrementConfigVersion: mock(() => Promise.resolve(2)),
      tierExists: mock(() => Promise.resolve(true)),
    };

    const redisClient = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve('OK')),
      del: mock(() => Promise.resolve(1)),
      publish: mock(() => Promise.resolve(1)),
    } as any;

    const eventEmitter = {
      emit: mock(() => true),
    } as any;

    return { tenantRepo, redisClient, eventEmitter };
  };

  it('should reject all 15 reserved tenant slugs with 400 INVALID_TENANT_SLUG', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
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

  it('should normalize valid slug to lowercase and populate literal Redis slug cache with 300s EX TTL on createTenant', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
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
    expect(mocks.redisClient.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme-corp',
      JSON.stringify({
        id: created.id,
        slug: 'acme-corp',
        status: 'active',
        tierId: 'tier_free',
        configVersion: 1,
      } satisfies TenantSummaryCache),
      'EX',
      300,
    );
  });

  it('should reject duplicate slug on createTenant with 409 TENANT_SLUG_CONFLICT', async () => {
    const mocks = createMocks();
    (mocks.tenantRepo.findBySlug as ReturnType<typeof mock>).mockResolvedValue(
      makeTenantRow({ slug: 'acme' }),
    );
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    let caught: unknown;
    try {
      await service.createTenant({
        name: 'Acme Corp',
        slug: 'acme',
        ownerUserId: 'usr_1',
        tierId: 'tier_free',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(409);
    expect((caught as BusinessError).code).toBe('TENANT_SLUG_CONFLICT');
    expect(mocks.tenantRepo.create).not.toHaveBeenCalled();
  });

  it('should translate PG 23505 unique constraint error on createTenant race to 409 TENANT_SLUG_CONFLICT', async () => {
    const mocks = createMocks();
    (mocks.tenantRepo.create as ReturnType<typeof mock>).mockRejectedValue({
      cause: { code: '23505', constraint: 'tenant_slug_unique' },
    });
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    let caught: unknown;
    try {
      await service.createTenant({
        name: 'Acme Corp',
        slug: 'acme-race',
        ownerUserId: 'usr_1',
        tierId: 'tier_free',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(409);
    expect((caught as BusinessError).code).toBe('TENANT_SLUG_CONFLICT');
  });

  it('should reject unknown tierId on createTenant with 400 INVALID_TIER', async () => {
    const mocks = createMocks();
    (mocks.tenantRepo.tierExists as ReturnType<typeof mock>).mockResolvedValue(
      false,
    );
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    let caught: unknown;
    try {
      await service.createTenant({
        name: 'Acme Corp',
        slug: 'acme-tier',
        ownerUserId: 'usr_1',
        tierId: 'tier_nonexistent',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(400);
    expect((caught as BusinessError).code).toBe('INVALID_TIER');
    expect(mocks.tenantRepo.create).not.toHaveBeenCalled();
  });

  it('should translate PG 23503 foreign key violation for invalid ownerUserId on createTenant to 404 USER_NOT_FOUND', async () => {
    const mocks = createMocks();
    (mocks.tenantRepo.create as ReturnType<typeof mock>).mockRejectedValue({
      code: '23503',
      constraint: 'tenant_owner_user_id_user_id_fk',
    });
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    let caught: unknown;
    try {
      await service.createTenant({
        name: 'Acme Corp',
        slug: 'acme-owner',
        ownerUserId: 'usr_missing',
        tierId: 'tier_free',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(404);
    expect((caught as BusinessError).code).toBe('USER_NOT_FOUND');
  });

  it('should reject attempt to change slug on updateTenant with 400 TENANT_SLUG_IMMUTABLE', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
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

  it('should allow slug through ValidationPipe whitelist on UpdateTenantDto so TenantService rejects with 400 TENANT_SLUG_IMMUTABLE', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    const transformed = (await pipe.transform(
      { slug: 'new-slug' },
      { type: 'body', metatype: UpdateTenantDto },
    )) as UpdateTenantDto;

    expect(transformed.slug).toBe('new-slug');

    let caught: unknown;
    try {
      await service.updateTenant('ten_1', transformed);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(400);
    expect((caught as BusinessError).code).toBe('TENANT_SLUG_IMMUTABLE');
  });

  it('should atomically bump configVersion via repo update, update literal Redis slug cache, and publish invalidation when tier changes', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      tierId: 'tier_business',
    });

    expect(mocks.tenantRepo.update).toHaveBeenCalledWith(
      'ten_1',
      { tierId: 'tier_business' },
      { bumpConfigVersion: true },
    );
    expect(updated.configVersion).toBe(2);
    expect(updated.tierId).toBe('tier_business');
    expect(mocks.redisClient.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme',
      JSON.stringify({
        id: 'ten_1',
        slug: 'acme',
        status: 'active',
        tierId: 'tier_business',
        configVersion: 2,
      } satisfies TenantSummaryCache),
      'EX',
      300,
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledWith(
      'authcore:config:invalidated',
      JSON.stringify({
        scope: 'tenant',
        tenantId: 'ten_1',
        slug: 'acme',
        configVersion: 2,
      }),
    );
    expect(mocks.eventEmitter.emit).toHaveBeenCalledWith(
      'tenant.config.invalidated',
      {
        scope: 'tenant',
        tenantId: 'ten_1',
        slug: 'acme',
        configVersion: 2,
      },
    );
  });

  it('should atomically bump configVersion, update literal Redis slug cache, and publish invalidation when status changes to suspended', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      status: 'suspended',
    });

    expect(mocks.tenantRepo.update).toHaveBeenCalledWith(
      'ten_1',
      { status: 'suspended' },
      { bumpConfigVersion: true },
    );
    expect(updated.status).toBe('suspended');
    expect(updated.configVersion).toBe(2);
    expect(mocks.redisClient.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme',
      JSON.stringify({
        id: 'ten_1',
        slug: 'acme',
        status: 'suspended',
        tierId: 'tier_free',
        configVersion: 2,
      } satisfies TenantSummaryCache),
      'EX',
      300,
    );
    expect(mocks.redisClient.publish).toHaveBeenCalledTimes(1);
  });

  it('should not bump configVersion or publish invalidation when only name is updated', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      name: 'Acme Renamed',
    });

    expect(mocks.tenantRepo.update).toHaveBeenCalledWith(
      'ten_1',
      { name: 'Acme Renamed' },
      { bumpConfigVersion: false },
    );
    expect(updated.configVersion).toBe(1);
    expect(mocks.redisClient.publish).not.toHaveBeenCalled();
    expect(mocks.redisClient.set).toHaveBeenCalledTimes(1);
  });

  it('should return cached summary on literal Redis key hit in resolveSlugSummary without querying DB', async () => {
    const mocks = createMocks();
    const cached: TenantSummaryCache = {
      id: 'ten_1',
      slug: 'acme',
      status: 'active',
      tierId: 'tier_business',
      configVersion: 3,
    };
    mocks.redisClient.get = mock(() => Promise.resolve(JSON.stringify(cached)));

    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const summary = await service.resolveSlugSummary(' ACME ');
    expect(summary).toEqual(cached);
    expect(mocks.redisClient.get).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme',
    );
    expect(mocks.tenantRepo.findBySlug).not.toHaveBeenCalled();
  });

  it('should fall back to DB on Redis miss in resolveSlugSummary and backfill literal key with 300s EX TTL', async () => {
    const mocks = createMocks();
    (mocks.tenantRepo.findBySlug as ReturnType<typeof mock>).mockResolvedValue(
      makeTenantRow({ slug: 'acme', tierId: 'tier_basic', configVersion: 4 }),
    );
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const summary = await service.resolveSlugSummary('acme');
    expect(summary).toEqual({
      id: 'ten_1',
      slug: 'acme',
      status: 'active',
      tierId: 'tier_basic',
      configVersion: 4,
    });
    expect(mocks.redisClient.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:acme',
      JSON.stringify({
        id: 'ten_1',
        slug: 'acme',
        status: 'active',
        tierId: 'tier_basic',
        configVersion: 4,
      }),
      'EX',
      300,
    );
  });

  it('should return null in resolveSlugSummary for reserved slugs without hitting Redis or DB', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    expect(await service.resolveSlugSummary('admin')).toBeNull();
    expect(await service.resolveSlugSummary('auth')).toBeNull();
    expect(mocks.redisClient.get).not.toHaveBeenCalled();
    expect(mocks.tenantRepo.findBySlug).not.toHaveBeenCalled();
  });

  it('should gracefully handle Redis unavailability during cache sync and pubsub invalidation', async () => {
    const mocks = createMocks();
    mocks.redisClient.set = mock(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );
    mocks.redisClient.publish = mock(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );

    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const updated = await service.updateTenant('ten_1', {
      status: 'suspended',
    });
    expect(updated.status).toBe('suspended');
    expect(updated.configVersion).toBe(2);
  });

  it('should clamp negative page and oversized/negative pageSize and forward ownerUserId on listTenants', async () => {
    const mocks = createMocks();
    const service = new TenantService(
      mocks.tenantRepo,
      mocks.redisClient,
      mocks.eventEmitter,
    );

    const resNeg = await service.listTenants({
      page: -3,
      pageSize: -5,
      ownerUserId: 'usr_owner_1',
    });
    expect(resNeg.page).toBe(0);
    expect(resNeg.pageSize).toBe(10);
    expect(mocks.tenantRepo.listPaginated).toHaveBeenCalledWith({
      page: 0,
      pageSize: 10,
      search: undefined,
      status: undefined,
      tierId: undefined,
      ownerUserId: 'usr_owner_1',
    });

    const resMax = await service.listTenants({ page: 2, pageSize: 500 });
    expect(resMax.page).toBe(2);
    expect(resMax.pageSize).toBe(100);
  });
});
