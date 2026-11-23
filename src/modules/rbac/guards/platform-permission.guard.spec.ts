import { describe, expect, it, mock } from 'bun:test';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as schema from '@/database/schema';
import { RequirePlatformPermission } from '../decorators/require-platform-permission.decorator';
import { PlatformPermissionGuard } from './platform-permission.guard';

describe('PlatformPermissionGuard', () => {
  const createExecutionContext = (
    handler: (...args: any[]) => unknown,
    session: unknown,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => ({ session }),
      }),
    }) as unknown as ExecutionContext;

  const makeSimpleDbMock = (
    rows: Array<{ slug: string; permissions: Record<string, string[]> }>,
  ) =>
    ({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve(rows.slice(0, 1))),
            then: (resolve: (value: typeof rows) => unknown) =>
              Promise.resolve(rows).then(resolve),
          })),
        })),
      })),
    }) as any;

  const makeTableAwareDbMock = (opts: {
    userRows: Array<{ tenantId: string | null }>;
    roleRows: Array<{ slug: string; permissions: Record<string, string[]> }>;
  }) =>
    ({
      select: mock(() => ({
        from: mock((table: unknown) => {
          const rows = table === schema.user ? opts.userRows : opts.roleRows;
          return {
            where: mock(() => ({
              limit: mock(() => Promise.resolve(rows.slice(0, 1))),
              then: (resolve: (value: typeof rows) => unknown) =>
                Promise.resolve(rows).then(resolve),
            })),
          };
        }),
      })),
    }) as any;

  it('should throw on invalid permission format in @RequirePlatformPermission', () => {
    expect(() => RequirePlatformPermission('auditLog')).toThrow();
    expect(() => RequirePlatformPermission('auditLog:')).toThrow();
    expect(() => RequirePlatformPermission(':read')).toThrow();
    expect(() => RequirePlatformPermission('a:b:c')).toThrow();
  });

  it('should reject unauthenticated requests with 401 UnauthorizedException', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:read')
      listAuditLogs() {}
    }

    const guard = new PlatformPermissionGuard(
      new Reflector(),
      makeSimpleDbMock([]),
    );

    const ctxNoSession = createExecutionContext(
      DummyController.prototype.listAuditLogs,
      null,
    );
    await expect(guard.canActivate(ctxNoSession)).rejects.toThrow(
      UnauthorizedException,
    );

    const ctxNoUser = createExecutionContext(
      DummyController.prototype.listAuditLogs,
      {},
    );
    await expect(guard.canActivate(ctxNoUser)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should reject tenant users (tenantId !== null) with 403 even if role is admin', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:read')
      listAuditLogs() {}
    }

    const db = makeSimpleDbMock([
      {
        slug: 'admin',
        permissions: { auditLog: ['read', 'export'], user: ['delete'] },
      },
    ]);
    const guard = new PlatformPermissionGuard(new Reflector(), db);

    const ctx = createExecutionContext(
      DummyController.prototype.listAuditLogs,
      {
        user: {
          id: 'usr_tenant_admin',
          email: 'tenant-admin@acme.test',
          role: 'admin',
          tenantId: 'ten_acme',
        },
      },
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('should allow auditor with auditLog:read on @RequirePlatformPermission("auditLog:read")', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:read')
      listAuditLogs() {}
    }

    const db = makeSimpleDbMock([
      {
        slug: 'auditor',
        permissions: {
          user: ['read'],
          auditLog: ['read', 'export'],
        },
      },
    ]);
    const guard = new PlatformPermissionGuard(new Reflector(), db);

    const ctx = createExecutionContext(
      DummyController.prototype.listAuditLogs,
      {
        user: {
          id: 'usr_auditor',
          email: 'auditor@authcore.io',
          role: 'auditor',
          tenantId: null,
        },
      },
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should reject auditor with 403 on @RequirePlatformPermission("user:delete")', async () => {
    class DummyController {
      @RequirePlatformPermission('user:delete')
      deleteUser() {}
    }

    const db = makeSimpleDbMock([
      {
        slug: 'auditor',
        permissions: {
          user: ['read'],
          auditLog: ['read', 'export'],
        },
      },
    ]);
    const guard = new PlatformPermissionGuard(new Reflector(), db);

    const ctx = createExecutionContext(DummyController.prototype.deleteUser, {
      user: {
        id: 'usr_auditor',
        email: 'auditor@authcore.io',
        role: 'auditor',
        tenantId: null,
      },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should reject when role is missing or not found in auth_core_role', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:read')
      listAuditLogs() {}
    }

    const guardNoRole = new PlatformPermissionGuard(
      new Reflector(),
      makeSimpleDbMock([]),
    );
    await expect(
      guardNoRole.canActivate(
        createExecutionContext(DummyController.prototype.listAuditLogs, {
          user: { id: 'u1', role: null, tenantId: null },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      guardNoRole.canActivate(
        createExecutionContext(DummyController.prototype.listAuditLogs, {
          user: { id: 'u1', role: 'unknown_role', tenantId: null },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should allow comma-separated roles when any assigned role has the required permission', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:export')
      exportAuditLogs() {}
    }

    const db = makeSimpleDbMock([
      { slug: 'user', permissions: {} },
      { slug: 'auditor', permissions: { auditLog: ['read', 'export'] } },
    ]);
    const guard = new PlatformPermissionGuard(new Reflector(), db);

    const ctx = createExecutionContext(
      DummyController.prototype.exportAuditLogs,
      {
        user: {
          id: 'u_multi',
          role: 'user, auditor',
          tenantId: null,
        },
      },
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should reject when session.user.tenantId is undefined and DB user has tenantId or is missing', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:read')
      listAuditLogs() {}
    }

    const roleRows = [
      {
        slug: 'admin',
        permissions: { auditLog: ['read', 'export'] },
      },
    ];

    const tenantDb = makeTableAwareDbMock({
      userRows: [{ tenantId: 'ten_pos' }],
      roleRows,
    });
    const guardTenantDb = new PlatformPermissionGuard(
      new Reflector(),
      tenantDb,
    );

    await expect(
      guardTenantDb.canActivate(
        createExecutionContext(DummyController.prototype.listAuditLogs, {
          user: {
            id: 'usr_tenant_admin',
            role: 'admin',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);

    const missingUserDb = makeTableAwareDbMock({
      userRows: [],
      roleRows,
    });
    const guardMissingUser = new PlatformPermissionGuard(
      new Reflector(),
      missingUserDb,
    );

    await expect(
      guardMissingUser.canActivate(
        createExecutionContext(DummyController.prototype.listAuditLogs, {
          user: {
            id: 'usr_missing',
            role: 'admin',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      guardMissingUser.canActivate(
        createExecutionContext(DummyController.prototype.listAuditLogs, {
          user: {
            role: 'admin',
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should allow access when session.user.tenantId is undefined but DB user has tenantId === null and required permission', async () => {
    class DummyController {
      @RequirePlatformPermission('auditLog:read')
      listAuditLogs() {}
    }

    const db = makeTableAwareDbMock({
      userRows: [{ tenantId: null }],
      roleRows: [
        {
          slug: 'auditor',
          permissions: { auditLog: ['read', 'export'] },
        },
      ],
    });
    const guard = new PlatformPermissionGuard(new Reflector(), db);

    const ctx = createExecutionContext(
      DummyController.prototype.listAuditLogs,
      {
        user: {
          id: 'usr_platform_auditor',
          role: 'auditor',
        },
      },
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should pass through when @RequirePlatformPermission is not set', async () => {
    class DummyController {
      openMethod() {}
    }

    const guard = new PlatformPermissionGuard(
      new Reflector(),
      makeSimpleDbMock([]),
    );
    const ctx = createExecutionContext(
      DummyController.prototype.openMethod,
      null,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
