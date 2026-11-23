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
