import 'reflect-metadata';
import { describe, expect, it, mock } from 'bun:test';
import type { Organization } from '@/database/schema';
import type {
  IPortalTenantOrgRepository,
  ListTenantOrgsQuery,
} from '../interfaces/portal-tenant-org-repository.interface';
import { PortalTenantOrgRepository } from '../repositories/portal-tenant-org.repository';
import { PortalTenantOrgsService } from './portal-tenant-orgs.service';

describe('PortalTenantOrgsService (Strict Tenant Isolation)', () => {
  const makeOrgRow = (overrides: Partial<Organization> = {}): Organization => ({
    id: 'org_1',
    tenantId: 'ten_amir',
    name: 'Amir Org',
    slug: 'amir-org',
    logo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    metadata: null,
    ...overrides,
  });

  it('should never return organizations from ten_bima when querying listTenantOrganizations("ten_amir", ...)', async () => {
    const allOrgs: Organization[] = [
      makeOrgRow({
        id: 'org_amir_1',
        tenantId: 'ten_amir',
        name: 'Amir Org 1',
        slug: 'amir-org-1',
      }),
      makeOrgRow({
        id: 'org_amir_2',
        tenantId: 'ten_amir',
        name: 'Amir Org 2',
        slug: 'amir-org-2',
      }),
      makeOrgRow({
        id: 'org_bima_1',
        tenantId: 'ten_bima',
        name: 'Bima Org',
        slug: 'bima-org',
      }),
    ];

    const listByTenantPaginated = mock((query: ListTenantOrgsQuery) => {
      const filtered = allOrgs.filter((o) => o.tenantId === query.tenantId);
      return Promise.resolve({
        items: filtered,
        total: filtered.length,
      });
    });

    const repo: IPortalTenantOrgRepository = {
      listByTenantPaginated,
    };

    const service = new PortalTenantOrgsService(repo);
    const result = await service.listTenantOrganizations('ten_amir', {
      page: 0,
      pageSize: 10,
    });

    expect(listByTenantPaginated).toHaveBeenCalledWith({
      tenantId: 'ten_amir',
      page: 0,
      pageSize: 10,
      search: undefined,
    });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((o) => o.tenantId === 'ten_amir')).toBe(true);
    expect(result.items.some((o) => o.id === 'org_bima_1')).toBe(false);
  });

  it('should clamp pagination and forward trimmed search query to repository', async () => {
    const listByTenantPaginated = mock((_query: ListTenantOrgsQuery) =>
      Promise.resolve({
        items: [
          makeOrgRow({
            id: 'org_amir_1',
            tenantId: 'ten_amir',
            name: 'Nusantara Tech',
            slug: 'nusantara-tech',
          }),
        ],
        total: 1,
      }),
    );

    const service = new PortalTenantOrgsService({ listByTenantPaginated });
    const result = await service.listTenantOrganizations('ten_amir', {
      page: -2,
      pageSize: 500,
      search: '  nusantara  ',
    });

    expect(listByTenantPaginated).toHaveBeenCalledWith({
      tenantId: 'ten_amir',
      page: 0,
      pageSize: 100,
      search: 'nusantara',
    });
    expect(result.page).toBe(0);
    expect(result.pageSize).toBe(100);
    expect(result.total).toBe(1);
    expect(result.items[0]?.slug).toBe('nusantara-tech');
  });

  it('should support legacy limit query param when pageSize is omitted', async () => {
    const listByTenantPaginated = mock((_query: ListTenantOrgsQuery) =>
      Promise.resolve({
        items: [],
        total: 0,
      }),
    );

    const service = new PortalTenantOrgsService({ listByTenantPaginated });
    const result = await service.listTenantOrganizations('ten_amir', {
      page: 2,
      limit: 25,
    });

    expect(listByTenantPaginated).toHaveBeenCalledWith({
      tenantId: 'ten_amir',
      page: 2,
      pageSize: 25,
      search: undefined,
    });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(25);
  });

  it('should execute DB-level WHERE tenant_id = :tenantId with LIMIT and OFFSET in PortalTenantOrgRepository', async () => {
    const captured: {
      whereCalled: boolean;
      limitArg?: number;
      offsetArg?: number;
    } = { whereCalled: false };

    const selectChain = {
      from: mock(() => selectChain),
      where: mock(() => {
        captured.whereCalled = true;
        return selectChain;
      }),
      orderBy: mock(() => selectChain),
      limit: mock((n: number) => {
        captured.limitArg = n;
        return selectChain;
      }),
      offset: mock((n: number) => {
        captured.offsetArg = n;
        return Promise.resolve([
          makeOrgRow({ id: 'org_amir_1', tenantId: 'ten_amir' }),
        ]);
      }),
    };

    const countChain = {
      from: mock(() => countChain),
      where: mock(() => Promise.resolve([{ total: 1 }])),
    };

    let callIdx = 0;
    const fakeDb = {
      select: mock(() => {
        callIdx += 1;
        return callIdx === 1 ? selectChain : countChain;
      }),
    };

    const repo = new PortalTenantOrgRepository(fakeDb as never);
    const res = await repo.listByTenantPaginated({
      tenantId: 'ten_amir',
      page: 1,
      pageSize: 25,
      search: 'amir',
    });

    expect(captured.whereCalled).toBe(true);
    expect(captured.limitArg).toBe(25);
    expect(captured.offsetArg).toBe(25);
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.tenantId).toBe('ten_amir');
  });
});
