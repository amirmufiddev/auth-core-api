import 'reflect-metadata';
import { describe, expect, it, mock } from 'bun:test';
import type { User } from '@/database/schema';
import type {
  IPortalTenantUserRepository,
  ListTenantUsersQuery,
} from '../interfaces/portal-tenant-user-repository.interface';
import { PortalTenantUserRepository } from '../repositories/portal-tenant-user.repository';
import { PortalTenantUsersService } from './portal-tenant-users.service';

describe('PortalTenantUsersService (Strict Tenant Isolation)', () => {
  const makeUserRow = (overrides: Partial<User> = {}): User => ({
    id: 'usr_1',
    tenantId: 'ten_amir',
    name: 'Amir User',
    email: 'user@amir.test',
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    role: 'member',
    banned: false,
    banReason: null,
    banExpires: null,
    username: 'amiruser',
    displayUsername: 'amiruser',
    phoneNumber: null,
    phoneNumberVerified: false,
    twoFactorEnabled: false,
    isAnonymous: false,
    lastLoginMethod: 'email',
    stripeCustomerId: null,
    dodoCustomerId: null,
    creemCustomerId: null,
    hadTrial: false,
    chargebeeCustomerId: null,
    ...overrides,
  });

  it('should never return users from ten_bima or platform users (tenantId = null) when querying listTenantUsers("ten_amir", ...)', async () => {
    const allUsers: User[] = [
      makeUserRow({
        id: 'usr_amir_1',
        tenantId: 'ten_amir',
        name: 'Amir Member 1',
        email: 'member1@amir.test',
      }),
      makeUserRow({
        id: 'usr_amir_2',
        tenantId: 'ten_amir',
        name: 'Amir Member 2',
        email: 'member2@amir.test',
      }),
      makeUserRow({
        id: 'usr_bima_1',
        tenantId: 'ten_bima',
        name: 'Bima Member',
        email: 'member@bima.test',
      }),
      makeUserRow({
        id: 'usr_platform_1',
        tenantId: null,
        name: 'Platform Admin',
        email: 'admin@platform.test',
      }),
    ];

    const listByTenantPaginated = mock((query: ListTenantUsersQuery) => {
      const filtered = allUsers.filter((u) => u.tenantId === query.tenantId);
      return Promise.resolve({
        items: filtered,
        total: filtered.length,
      });
    });

    const repo: IPortalTenantUserRepository = {
      listByTenantPaginated,
    };

    const service = new PortalTenantUsersService(repo);
    const result = await service.listTenantUsers('ten_amir', {
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
    expect(result.items.every((u) => u.tenantId === 'ten_amir')).toBe(true);
    expect(result.items.some((u) => u.id === 'usr_bima_1')).toBe(false);
    expect(result.items.some((u) => u.id === 'usr_platform_1')).toBe(false);
  });

  it('should clamp pagination and forward trimmed search query to repository', async () => {
    const listByTenantPaginated = mock((_query: ListTenantUsersQuery) =>
      Promise.resolve({
        items: [
          makeUserRow({
            id: 'usr_amir_1',
            tenantId: 'ten_amir',
            name: 'Siti Rahma',
            email: 'siti@amir.test',
          }),
        ],
        total: 1,
      }),
    );

    const service = new PortalTenantUsersService({ listByTenantPaginated });
    const result = await service.listTenantUsers('ten_amir', {
      page: -3,
      pageSize: 500,
      search: '  siti  ',
    });

    expect(listByTenantPaginated).toHaveBeenCalledWith({
      tenantId: 'ten_amir',
      page: 0,
      pageSize: 100,
      search: 'siti',
    });
    expect(result.page).toBe(0);
    expect(result.pageSize).toBe(100);
    expect(result.total).toBe(1);
    expect(result.items[0]?.email).toBe('siti@amir.test');
  });

  it('should execute DB-level WHERE tenant_id = :tenantId with LIMIT and OFFSET in PortalTenantUserRepository', async () => {
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
          makeUserRow({ id: 'usr_amir_1', tenantId: 'ten_amir' }),
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

    const repo = new PortalTenantUserRepository(fakeDb as never);
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
