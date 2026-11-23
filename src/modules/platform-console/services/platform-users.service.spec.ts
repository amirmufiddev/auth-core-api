import * as argon2 from 'argon2';
import { describe, expect, it, mock } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { User } from '@/database/schema';
import type {
  IPlatformAuditRepository,
  IPlatformSessionRepository,
  IPlatformUserRepository,
  ListUsersQuery,
} from '../interfaces/platform-console-repositories.interface';
import { PlatformUsersService } from './platform-users.service';

describe('PlatformUsersService', () => {
  const actor = {
    id: 'usr_admin',
    email: 'admin@authcore.io',
    role: 'super_admin',
  };

  const makeUserRow = (overrides: Partial<User> = {}): User =>
    ({
      id: 'usr_1',
      tenantId: null,
      name: 'Platform Admin',
      email: 'platform@authcore.io',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      role: 'admin',
      banned: false,
      banReason: null,
      banExpires: null,
      username: 'platformadmin',
      displayUsername: 'platformadmin',
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
    }) as User;

  const createMocks = () => {
    const userRepo: IPlatformUserRepository = {
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      findPlatformById: mock(() => Promise.resolve(null)),
      findPlatformByEmail: mock(() => Promise.resolve(null)),
      createPlatformUser: mock((input) =>
        Promise.resolve(
          makeUserRow({
            id: input.id,
            name: input.name,
            email: input.email,
            username: input.username,
            role: input.role,
            emailVerified: input.emailVerified,
            twoFactorEnabled: input.twoFactorEnabled,
          }),
        ),
      ),
      updatePlatformUser: mock((_id, patch) =>
        Promise.resolve(makeUserRow({ ...patch })),
      ),
      deletePlatformUser: mock(() => Promise.resolve(undefined)),
      getProfileRelations: mock(() =>
        Promise.resolve({
          accounts: [],
          passkeys: [],
          organizationName: undefined,
        }),
      ),
      getPasskeyCounts: mock(() => Promise.resolve(new Map<string, number>())),
      getPrimaryOrgNames: mock(() =>
        Promise.resolve(new Map<string, string>()),
      ),
      getDashboardStats: mock(() =>
        Promise.resolve({
          totalUsers: 0,
          bannedUsers: 0,
          twoFactorUsers: 0,
          authMethodDistribution: [],
        }),
      ),
      getUserCountsByRole: mock(() =>
        Promise.resolve(new Map<string, number>()),
      ),
    };

    const sessionRepo: IPlatformSessionRepository = {
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      findById: mock(() => Promise.resolve(null)),
      deleteById: mock(() => Promise.resolve(undefined)),
      deleteByUserId: mock(() => Promise.resolve(undefined)),
      deleteExpired: mock(() => Promise.resolve(0)),
      countActive: mock(() => Promise.resolve(0)),
      countCreatedByDay: mock(() => Promise.resolve([])),
    };

    const auditRepo: IPlatformAuditRepository = {
      create: mock(() => Promise.resolve(undefined)),
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      listRecent: mock(() => Promise.resolve([])),
      countSince: mock(() => Promise.resolve(0)),
      countCreatedByDay: mock(() => Promise.resolve([])),
    };

    const featureConfig = {
      assertFeatureEnabled: mock(() => undefined),
      isFeatureEnabled: mock(() => false),
    } as any;

    const emailService = {
      send: mock(() => Promise.resolve(undefined)),
    } as any;

    const configService = {
      get: mock((key: string) => {
        if (key === 'app') return { appName: 'Auth Core' };
        if (key === 'auth.clientUrl') return 'http://localhost:2000';
        return undefined;
      }),
    } as any;

    return {
      userRepo,
      sessionRepo,
      auditRepo,
      featureConfig,
      emailService,
      configService,
    };
  };

  it('should forward filters and pagination to IPlatformUserRepository.listPaginated without full-table scan', async () => {
    const mocks = createMocks();
    const platformUser = makeUserRow({
      id: 'usr_plat_1',
      tenantId: null,
      email: 'plat@authcore.io',
    });

    (mocks.userRepo.listPaginated as ReturnType<typeof mock>).mockResolvedValue(
      {
        items: [platformUser],
        total: 42,
      },
    );
    (
      mocks.userRepo.getPasskeyCounts as ReturnType<typeof mock>
    ).mockResolvedValue(new Map([['usr_plat_1', 2]]));
    (
      mocks.userRepo.getPrimaryOrgNames as ReturnType<typeof mock>
    ).mockResolvedValue(new Map([['usr_plat_1', 'Auth Core HQ']]));

    const service = new PlatformUsersService(
      mocks.userRepo,
      mocks.sessionRepo,
      mocks.auditRepo,
      mocks.featureConfig,
      mocks.emailService,
      mocks.configService,
    );

    const query: ListUsersQuery = {
      page: 2,
      pageSize: 15,
      search: 'plat',
      role: 'admin',
      status: 'active',
      sortBy: 'email',
      sortDir: 'asc',
    };

    const result = await service.listUsers(query);

    expect(mocks.userRepo.listPaginated).toHaveBeenCalledTimes(1);
    expect(mocks.userRepo.listPaginated).toHaveBeenCalledWith(query);
    expect(mocks.userRepo.getPasskeyCounts).toHaveBeenCalledWith([
      'usr_plat_1',
    ]);
    expect(mocks.userRepo.getPrimaryOrgNames).toHaveBeenCalledWith([
      'usr_plat_1',
    ]);
    expect(result).toMatchObject({
      total: 42,
      page: 2,
      pageSize: 15,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'usr_plat_1',
      email: 'plat@authcore.io',
      passkeyCount: 2,
      organizationName: 'Auth Core HQ',
    });
  });

  it('should reject tenant-scoped users when findPlatformById returns null', async () => {
    const mocks = createMocks();
    (
      mocks.userRepo.findPlatformById as ReturnType<typeof mock>
    ).mockResolvedValue(null);

    const service = new PlatformUsersService(
      mocks.userRepo,
      mocks.sessionRepo,
      mocks.auditRepo,
      mocks.featureConfig,
      mocks.emailService,
      mocks.configService,
    );

    await expect(service.getMe('usr_tenant_only')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.updateUser('usr_tenant_only', { name: 'Hack' }, actor),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.banOrUnbanUser('usr_tenant_only', { banned: true }, actor),
    ).rejects.toThrow(NotFoundException);
    await expect(service.deleteUser('usr_tenant_only', actor)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should create platform user with random password hash instead of Admin12345! when password is omitted', async () => {
    const mocks = createMocks();
    const service = new PlatformUsersService(
      mocks.userRepo,
      mocks.sessionRepo,
      mocks.auditRepo,
      mocks.featureConfig,
      mocks.emailService,
      mocks.configService,
    );

    await service.createUser(
      {
        name: 'Alice',
        email: 'Alice@Example.com',
        role: 'user',
        emailVerified: true,
        twoFactorEnabled: false,
      },
      actor,
    );

    expect(mocks.userRepo.createPlatformUser).toHaveBeenCalledTimes(1);
    const createdArg = (
      mocks.userRepo.createPlatformUser as ReturnType<typeof mock>
    ).mock.calls[0][0];
    expect(createdArg.email).toBe('alice@example.com');
    expect(await argon2.verify(createdArg.passwordHash, 'Admin12345!')).toBe(
      false,
    );
    expect(mocks.emailService.send).toHaveBeenCalledTimes(1);
  });

  it('should throw ConflictException when platform email already exists', async () => {
    const mocks = createMocks();
    (
      mocks.userRepo.findPlatformByEmail as ReturnType<typeof mock>
    ).mockResolvedValue(makeUserRow());

    const service = new PlatformUsersService(
      mocks.userRepo,
      mocks.sessionRepo,
      mocks.auditRepo,
      mocks.featureConfig,
      mocks.emailService,
      mocks.configService,
    );

    await expect(
      service.createUser(
        {
          name: 'Dup',
          email: 'platform@authcore.io',
          role: 'user',
          emailVerified: true,
          twoFactorEnabled: false,
        },
        actor,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('should revoke user sessions via IPlatformSessionRepository when banning a user', async () => {
    const mocks = createMocks();
    (
      mocks.userRepo.findPlatformById as ReturnType<typeof mock>
    ).mockResolvedValue(makeUserRow({ id: 'usr_target' }));
    (
      mocks.userRepo.updatePlatformUser as ReturnType<typeof mock>
    ).mockResolvedValue(makeUserRow({ id: 'usr_target', banned: true }));

    const service = new PlatformUsersService(
      mocks.userRepo,
      mocks.sessionRepo,
      mocks.auditRepo,
      mocks.featureConfig,
      mocks.emailService,
      mocks.configService,
    );

    await service.banOrUnbanUser(
      'usr_target',
      { banned: true, banReason: 'Violation' },
      actor,
    );

    expect(mocks.sessionRepo.deleteByUserId).toHaveBeenCalledWith('usr_target');
  });
});
