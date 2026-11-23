import { describe, expect, it, mock } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { PLATFORM_PERMISSION_META_KEY } from '@/modules/rbac';
import { AuthConfigController } from '../controllers/auth-config.controller';
import { PlatformConsoleController } from '../controllers/platform-console.controller';
import type {
  IPlatformAuditRepository,
  IPlatformSessionRepository,
  IPlatformUserRepository,
} from '../interfaces';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformMetricsService } from './platform-metrics.service';
import { PlatformSessionsService } from './platform-sessions.service';

describe('PlatformSessionsService, PlatformAuditService, PlatformMetricsService & Controller Permissions', () => {
  const actor = {
    id: 'usr_1',
    email: 'admin@authcore.io',
    role: 'super_admin',
  };

  it('should delegate session pagination and expired revocation to IPlatformSessionRepository', async () => {
    const sessionRepo: IPlatformSessionRepository = {
      listPaginated: mock(() =>
        Promise.resolve({
          items: [
            {
              id: 'ses_1',
              userId: 'usr_1',
              userName: 'Admin',
              userEmail: 'admin@authcore.io',
              token: 'tok_1234567890abcdef',
              ipAddress: '10.0.0.1',
              userAgent: 'Mozilla/5.0',
              impersonatedBy: null,
              createdAt: new Date('2026-01-01T00:00:00Z'),
              expiresAt: new Date(Date.now() + 60000),
            },
          ],
          total: 12,
        }),
      ),
      findById: mock(() => Promise.resolve(null)),
      deleteById: mock(() => Promise.resolve(undefined)),
      deleteByUserId: mock(() => Promise.resolve(undefined)),
      deleteExpired: mock(() => Promise.resolve(4)),
      countActive: mock(() => Promise.resolve(5)),
      countCreatedByDay: mock(() => Promise.resolve([])),
    };
    const auditService = {
      recordAudit: mock(() => Promise.resolve(undefined)),
    } as any;

    const service = new PlatformSessionsService(sessionRepo, auditService);
    const list = await service.listSessions({
      page: 1,
      pageSize: 5,
      status: 'active',
    });

    expect(sessionRepo.listPaginated).toHaveBeenCalledWith({
      page: 1,
      pageSize: 5,
      status: 'active',
    });
    expect(list.total).toBe(12);
    expect(list.items[0].active).toBe(true);
    expect(await service.revokeInactiveSessions()).toBe(4);
    await expect(service.revokeSession('missing', actor)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should delegate audit cursor pagination to IPlatformAuditRepository', async () => {
    const auditRepo: IPlatformAuditRepository = {
      create: mock(() => Promise.resolve(undefined)),
      listPaginated: mock(() =>
        Promise.resolve({
          items: [
            {
              id: 'aud_1',
              tenantId: null,
              moduleKey: 'admin',
              actorId: 'usr_1',
              category: 'admin',
              severity: 'info',
              actorEmail: 'admin@authcore.io',
              actorRole: 'super_admin',
              target: 'user/a@b.com',
              ipAddress: '127.0.0.1',
              userAgent: 'AuthCoreAPI',
              action: 'admin.user_created',
              entityType: 'admin',
              entityId: 'user/a@b.com',
              oldValue: null,
              newValue: null,
              metadata: {},
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
          ],
          total: 30,
        }),
      ),
      listRecent: mock(() => Promise.resolve([])),
      countSince: mock(() => Promise.resolve(0)),
      countCreatedByDay: mock(() => Promise.resolve([])),
    };
    const featureConfig = {
      assertFeatureEnabled: mock(() => undefined),
      isFeatureEnabled: mock(() => true),
    } as any;

    const service = new PlatformAuditService(auditRepo, featureConfig);
    const page = await service.fetchAuditLogsPage({
      cursor: 10,
      limit: 10,
      severity: 'info',
    });

    expect(auditRepo.listPaginated).toHaveBeenCalledWith({
      cursor: 10,
      limit: 10,
      severity: 'info',
    });
    expect(page.totalCount).toBe(30);
    expect(page.nextCursor).toBe(20);
    expect(page.items).toHaveLength(1);
  });

  it('should compute dashboard metrics from repository SQL aggregates without full-table scans', async () => {
    const userRepo = {
      getDashboardStats: mock(() =>
        Promise.resolve({
          totalUsers: 10,
          bannedUsers: 2,
          twoFactorUsers: 5,
          authMethodDistribution: [{ method: 'EMAIL', count: 10 }],
        }),
      ),
    } as unknown as IPlatformUserRepository;
    const sessionRepo = {
      countActive: mock(() => Promise.resolve(7)),
      countCreatedByDay: mock(() => Promise.resolve([])),
    } as unknown as IPlatformSessionRepository;
    const auditRepo = {
      countSince: mock(() => Promise.resolve(3)),
      countCreatedByDay: mock(() => Promise.resolve([])),
      listRecent: mock(() => Promise.resolve([])),
    } as unknown as IPlatformAuditRepository;

    const service = new PlatformMetricsService(
      userRepo,
      sessionRepo,
      auditRepo,
    );
    const metrics = await service.getDashboardMetrics();

    expect(metrics.totalUsers).toBe(10);
    expect(metrics.bannedUsers).toBe(2);
    expect(metrics.twoFactorAdoption).toBe(50);
    expect(metrics.activeSessions).toBe(7);
    expect(metrics.authEvents24h).toBe(3);
    expect(metrics.signInTrend).toHaveLength(14);
  });

  it('should align getDashboardMetrics 14-day window, SQL day keys, and labels to UTC even in UTC+7', async () => {
    const originalNow = Date.now;
    // 2026-11-24T17:30:00Z is 2026-11-25 00:30:00 in UTC+7 (different local date)
    Date.now = () => Date.parse('2026-11-24T17:30:00.000Z');

    try {
      const userRepo = {
        getDashboardStats: mock(() =>
          Promise.resolve({
            totalUsers: 4,
            bannedUsers: 0,
            twoFactorUsers: 2,
            authMethodDistribution: [{ method: 'EMAIL', count: 4 }],
          }),
        ),
      } as unknown as IPlatformUserRepository;
      const sessionRepo = {
        countActive: mock(() => Promise.resolve(3)),
        countCreatedByDay: mock(() =>
          Promise.resolve([{ day: '2026-11-24', count: 5 }]),
        ),
      } as unknown as IPlatformSessionRepository;
      const auditRepo = {
        countSince: mock(() => Promise.resolve(2)),
        countCreatedByDay: mock(() =>
          Promise.resolve([{ day: '2026-11-24', count: 2 }]),
        ),
        listRecent: mock(() => Promise.resolve([])),
      } as unknown as IPlatformAuditRepository;

      const service = new PlatformMetricsService(
        userRepo,
        sessionRepo,
        auditRepo,
      );
      const metrics = await service.getDashboardMetrics();

      const sinceArg = (
        sessionRepo.countCreatedByDay as ReturnType<typeof mock>
      ).mock.calls[0][0] as Date;
      expect(sinceArg.toISOString()).toBe('2026-11-11T00:00:00.000Z');

      const expectedLastLabel = new Date(
        '2026-11-24T00:00:00.000Z',
      ).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
      });
      const lastBucket = metrics.signInTrend[13];
      expect(lastBucket.date).toBe(expectedLastLabel);
      expect(lastBucket.signIns).toBe(7);
      expect(lastBucket.tokensIssued).toBe(14);
    } finally {
      Date.now = originalNow;
    }
  });

  it('should clamp negative cursor and negative limit in PlatformAuditService.fetchAuditLogsPage', async () => {
    const auditRepo: IPlatformAuditRepository = {
      create: mock(() => Promise.resolve(undefined)),
      listPaginated: mock(() => Promise.resolve({ items: [], total: 30 })),
      listRecent: mock(() => Promise.resolve([])),
      countSince: mock(() => Promise.resolve(0)),
      countCreatedByDay: mock(() => Promise.resolve([])),
    };
    const featureConfig = {
      assertFeatureEnabled: mock(() => undefined),
      isFeatureEnabled: mock(() => true),
    } as any;

    const service = new PlatformAuditService(auditRepo, featureConfig);
    const page = await service.fetchAuditLogsPage({
      cursor: -10,
      limit: -5,
    });

    expect(auditRepo.listPaginated).toHaveBeenCalledWith({
      cursor: 0,
      limit: 1,
    });
    expect(page.nextCursor).toBe(1);
    expect(page.totalCount).toBe(30);
  });

  it('should clamp negative and oversized pagination params in PlatformConsoleController', async () => {
    const usersService = {
      listUsers: mock(() => Promise.resolve({ items: [], total: 0 })),
    } as any;
    const organizationsService = {
      listOrganizations: mock(() => Promise.resolve({ items: [], total: 0 })),
    } as any;
    const auditService = {
      fetchAuditLogsPage: mock(() =>
        Promise.resolve({ items: [], nextCursor: null, totalCount: 0 }),
      ),
    } as any;

    const controller = new PlatformConsoleController(
      usersService,
      {} as any,
      organizationsService,
      {} as any,
      {} as any,
      {} as any,
      auditService,
      {} as any,
    );

    await controller.listUsers('-2', '-5');
    expect(usersService.listUsers).toHaveBeenCalledWith({
      page: 0,
      pageSize: 1,
      search: undefined,
      role: undefined,
      status: undefined,
      sortBy: undefined,
      sortDir: undefined,
    });

    await controller.listOrganizations('-1', '500');
    expect(organizationsService.listOrganizations).toHaveBeenCalledWith({
      page: 0,
      pageSize: 100,
      search: undefined,
    });

    await controller.listAuditLogs('-10', '-5');
    expect(auditService.fetchAuditLogsPage).toHaveBeenCalledWith({
      cursor: 0,
      limit: 1,
      search: undefined,
      severity: undefined,
      category: undefined,
      fromDate: undefined,
      toDate: undefined,
    });
  });

  it('should attach @RequirePlatformPermission metadata to protected routes and omit it on /me and GET /auth-config', () => {
    const getPerm = (target: object, method: string) =>
      Reflect.getMetadata(
        PLATFORM_PERMISSION_META_KEY,
        (target as Record<string, any>)[method],
      );

    expect(
      getPerm(PlatformConsoleController.prototype, 'getMe'),
    ).toBeUndefined();
    expect(getPerm(PlatformConsoleController.prototype, 'getMetrics')).toEqual({
      resource: 'user',
      action: 'read',
    });
    expect(getPerm(PlatformConsoleController.prototype, 'listUsers')).toEqual({
      resource: 'user',
      action: 'read',
    });
    expect(getPerm(PlatformConsoleController.prototype, 'createUser')).toEqual({
      resource: 'user',
      action: 'create',
    });
    expect(getPerm(PlatformConsoleController.prototype, 'deleteRole')).toEqual({
      resource: 'role',
      action: 'delete',
    });
    expect(
      getPerm(PlatformConsoleController.prototype, 'createOrganization'),
    ).toEqual({
      resource: 'organization',
      action: 'create',
    });
    expect(
      getPerm(PlatformConsoleController.prototype, 'revokeSession'),
    ).toEqual({
      resource: 'session',
      action: 'revoke',
    });
    expect(
      getPerm(PlatformConsoleController.prototype, 'createApiKey'),
    ).toEqual({
      resource: 'apiKey',
      action: 'create',
    });
    expect(
      getPerm(PlatformConsoleController.prototype, 'createOAuthClient'),
    ).toEqual({
      resource: 'oauthClient',
      action: 'create',
    });
    expect(
      getPerm(PlatformConsoleController.prototype, 'createSsoProvider'),
    ).toEqual({
      resource: 'sso',
      action: 'configure',
    });
    expect(
      getPerm(PlatformConsoleController.prototype, 'listAuditLogs'),
    ).toEqual({
      resource: 'auditLog',
      action: 'read',
    });
    expect(
      getPerm(AuthConfigController.prototype, 'getConfig'),
    ).toBeUndefined();
    expect(getPerm(AuthConfigController.prototype, 'updateConfig')).toEqual({
      resource: 'authConfig',
      action: 'configure',
    });
  });
});
