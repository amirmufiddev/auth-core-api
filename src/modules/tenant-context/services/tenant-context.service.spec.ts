import { describe, expect, it } from 'bun:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContextStorage } from '@/modules/tenant';
import {
  buildDefaultFeatureConfigFromEnv,
  resolveClampedAccessTokenTtlSeconds,
  resolveClampedJwtExpirationTime,
} from '@/modules/auth/auth';
import { TenantContextService } from './tenant-context.service';
import { TenantContextController } from '../controllers/tenant-context.controller';
import { TenantApiOrBearerGuard } from '../guards/tenant-api-or-bearer.guard';
import type { ITenantContextRepository } from '../interfaces/tenant-context-repository.interface';

function createInMemoryRepo(): {
  repo: ITenantContextRepository;
  state: {
    tenants: Array<{
      id: string;
      slug: string;
      status: 'active' | 'suspended';
    }>;
    users: Array<{ id: string; tenantId: string | null }>;
    organizations: Array<{
      id: string;
      tenantId: string;
      name: string;
      slug: string | null;
      logo: string | null;
      createdAt: Date;
    }>;
    members: Array<{
      id: string;
      tenantId: string | null;
      organizationId: string;
      userId: string;
      role: string;
      createdAt: Date;
    }>;
    organizationRoles: Array<{
      tenantId: string | null;
      organizationId: string;
      role: string;
      permission: string | null;
    }>;
    apiKeys: Array<{
      id: string;
      tenantId: string | null;
      referenceId: string;
      key: string;
      enabled: boolean | null;
      expiresAt: Date | null;
    }>;
  };
} {
  const state = {
    tenants: [
      { id: 'ten_pos', slug: 'pos', status: 'active' as const },
      { id: 'ten_bima', slug: 'bima', status: 'active' as const },
    ],
    users: [
      { id: 'usr_asep', tenantId: 'ten_pos' },
      { id: 'usr_bima', tenantId: 'ten_bima' },
    ],
    organizations: [
      {
        id: 'org_warung',
        tenantId: 'ten_pos',
        name: 'Warung Asep',
        slug: 'warung-asep',
        logo: null,
        createdAt: new Date(),
      },
      {
        id: 'org_bima',
        tenantId: 'ten_bima',
        name: 'Toko Bima',
        slug: 'toko-bima',
        logo: null,
        createdAt: new Date(),
      },
    ],
    members: [
      {
        id: 'mem_asep',
        tenantId: 'ten_pos',
        organizationId: 'org_warung',
        userId: 'usr_asep',
        role: 'owner',
        createdAt: new Date(),
      },
    ],
    organizationRoles: [
      {
        tenantId: 'ten_pos',
        organizationId: 'org_warung',
        role: 'owner',
        permission: JSON.stringify({
          member: ['read', 'invite', 'remove', 'update-role'],
          ac: ['create', 'read', 'update', 'delete'],
        }),
      },
      {
        tenantId: 'ten_pos',
        organizationId: 'org_warung',
        role: 'cashier',
        permission: JSON.stringify({
          member: ['read'],
        }),
      },
    ],
    apiKeys: [
      {
        id: 'key_pos_1',
        tenantId: 'ten_pos',
        referenceId: 'usr_asep',
        key: 'hashed_pos_key',
        enabled: true,
        expiresAt: null,
      },
      {
        id: 'key_bima_1',
        tenantId: 'ten_bima',
        referenceId: 'usr_bima',
        key: 'hashed_bima_key',
        enabled: true,
        expiresAt: null,
      },
    ],
  };

  const repo: ITenantContextRepository = {
    findTenantStatus(tenantId) {
      return Promise.resolve(
        state.tenants.find((t) => t.id === tenantId)?.status ?? null,
      );
    },
    findUserTenantId(userId) {
      const user = state.users.find((u) => u.id === userId);
      return Promise.resolve(user ? { tenantId: user.tenantId } : null);
    },
    findOrganizationById(organizationId) {
      return Promise.resolve(
        state.organizations.find((o) => o.id === organizationId) ?? null,
      );
    },
    findMemberInOrganization(organizationId, userId) {
      const m = state.members.find(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );
      return Promise.resolve(m ? { role: m.role, tenantId: m.tenantId } : null);
    },
    findOrganizationRolePermissions(organizationId, role) {
      const r = state.organizationRoles.find(
        (row) => row.organizationId === organizationId && row.role === role,
      );
      return Promise.resolve(r?.permission ?? null);
    },
    findApiKeyByHashedKey(hashedKey) {
      return Promise.resolve(
        state.apiKeys.find((k) => k.key === hashedKey) ?? null,
      );
    },
    listOrganizationsForTenant(params) {
      const filtered = state.organizations.filter(
        (o) => o.tenantId === params.tenantId,
      );
      return Promise.resolve({ items: filtered, total: filtered.length });
    },
    listOrganizationMembers(params) {
      const filtered = state.members
        .filter((m) => m.organizationId === params.organizationId)
        .map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
          userName: m.userId,
          userEmail: `${m.userId}@example.com`,
        }));
      return Promise.resolve({ items: filtered, total: filtered.length });
    },
  };

  return { repo, state };
}

describe('TenantContextService & POS Integration', () => {
  it('should return full context for Asep and reflect role revocation in real time', async () => {
    const { repo, state } = createInMemoryRepo();
    const service = new TenantContextService(repo);

    const initial = await service.getSessionContext({
      tenantId: 'ten_pos',
      userId: 'usr_asep',
      activeOrganizationId: 'org_warung',
    });

    expect(initial).toEqual({
      userId: 'usr_asep',
      tenantId: 'ten_pos',
      activeOrganizationId: 'org_warung',
      orgRole: 'owner',
      orgPermissions: [
        'member:read',
        'member:invite',
        'member:remove',
        'member:update-role',
        'ac:create',
        'ac:read',
        'ac:update',
        'ac:delete',
      ],
    });

    // Simulasikan downgrade role secara real-time
    state.members[0].role = 'cashier';
    const downgraded = await service.getSessionContext({
      tenantId: 'ten_pos',
      userId: 'usr_asep',
      activeOrganizationId: 'org_warung',
    });
    expect(downgraded.orgRole).toBe('cashier');
    expect(downgraded.orgPermissions).toEqual(['member:read']);

    // Simulasikan pencabutan membership secara real-time
    state.members.splice(0, 1);
    const revoked = await service.getSessionContext({
      tenantId: 'ten_pos',
      userId: 'usr_asep',
      activeOrganizationId: 'org_warung',
    });
    expect(revoked.activeOrganizationId).toBeNull();
    expect(revoked.orgRole).toBeNull();
    expect(revoked.orgPermissions).toEqual([]);
  });

  it('should reject cross-tenant activeOrganizationId spoofing with 403 ForbiddenException', async () => {
    const { repo } = createInMemoryRepo();
    const service = new TenantContextService(repo);

    await expect(
      service.getSessionContext({
        tenantId: 'ten_pos',
        userId: 'usr_asep',
        activeOrganizationId: 'org_bima',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should clamp tenant JWT Access Token TTL to <= 900 seconds (5-15 minutes)', () => {
    expect(resolveClampedAccessTokenTtlSeconds(3600)).toBe(900);
    expect(resolveClampedAccessTokenTtlSeconds(600)).toBe(600);
    expect(resolveClampedAccessTokenTtlSeconds(60)).toBe(300);
    expect(resolveClampedAccessTokenTtlSeconds(undefined)).toBe(900);

    expect(resolveClampedJwtExpirationTime('1h')).toBe('900s');
    expect(resolveClampedJwtExpirationTime('15m')).toBe('15m');
    expect(resolveClampedJwtExpirationTime('10m')).toBe('10m');
    expect(resolveClampedJwtExpirationTime('60s')).toBe('300s');

    const fc = buildDefaultFeatureConfigFromEnv(new ConfigService());
    expect(
      resolveClampedAccessTokenTtlSeconds(
        fc.oauthProvider.settings.accessTokenExpiresIn,
      ),
    ).toBeLessThanOrEqual(900);
  });

  it('should reject ten_bima Tenant API Key with 403 when calling ten_pos context endpoint', async () => {
    const { repo } = createInMemoryRepo();
    const service = new TenantContextService(repo);

    const mockAuthRegistry = {
      getForContext: (ctx: { tenantId: string | null }) =>
        Promise.resolve({
          api: {
            verifyApiKey: ({ body }: { body: { key: string } }) => {
              if (
                ctx.tenantId === 'ten_pos' &&
                body.key === 'ak_live_pos_secret'
              ) {
                return Promise.resolve({
                  valid: true,
                  error: null,
                  key: {
                    id: 'key_pos_1',
                    referenceId: 'usr_asep',
                    tenantId: 'ten_pos',
                  },
                });
              }
              return Promise.resolve({
                valid: false,
                error: { code: 'KEY_NOT_FOUND', message: 'Not found' },
                key: null,
              });
            },
            getSession: () => Promise.resolve(null),
          },
        }),
    };

    // Override findApiKeyByHashedKey to match sha256(rawKey) for ten_bima
    const crypto = await import('node:crypto');
    const bimaRawKey = 'ak_live_bima_secret';
    const bimaHash = crypto
      .createHash('sha256')
      .update(bimaRawKey)
      .digest('base64url');
    repo.findApiKeyByHashedKey = (hashed) => {
      if (hashed === bimaHash) {
        return Promise.resolve({
          id: 'key_bima_1',
          tenantId: 'ten_bima',
          referenceId: 'usr_bima',
          key: bimaHash,
          enabled: true,
          expiresAt: null,
        });
      }
      return Promise.resolve(null);
    };

    const guard = new TenantApiOrBearerGuard(
      mockAuthRegistry as never,
      service,
    );

    const makeExecutionContext = (headers: Record<string, string>) => {
      const req: Record<string, unknown> = { headers };
      return {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as never;
    };

    // 1. ten_bima API key on ten_pos context -> 403 ForbiddenException
    await expect(
      TenantContextStorage.run(
        {
          tenantId: 'ten_pos',
          slug: 'pos',
          tierId: null,
          configVersion: 1,
          source: 'subdomain',
        },
        () =>
          guard.canActivate(makeExecutionContext({ 'x-api-key': bimaRawKey })),
      ),
    ).rejects.toThrow(ForbiddenException);

    // 2. ten_pos API key on ten_pos context -> allowed
    const allowed = await TenantContextStorage.run(
      {
        tenantId: 'ten_pos',
        slug: 'pos',
        tierId: null,
        configVersion: 1,
        source: 'subdomain',
      },
      () =>
        guard.canActivate(
          makeExecutionContext({ 'x-api-key': 'ak_live_pos_secret' }),
        ),
    );
    expect(allowed).toBe(true);

    // 3. Missing credentials -> 401 UnauthorizedException
    await expect(
      TenantContextStorage.run(
        {
          tenantId: 'ten_pos',
          slug: 'pos',
          tierId: null,
          configVersion: 1,
          source: 'subdomain',
        },
        () => guard.canActivate(makeExecutionContext({})),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject bearer user with 403 on getOrganization / listOrganizationMembers for non-member org', async () => {
    const { repo, state } = createInMemoryRepo();
    state.organizations.push({
      id: 'org_other_pos',
      tenantId: 'ten_pos',
      name: 'Cabang Lain',
      slug: 'cabang-lain',
      logo: null,
      createdAt: new Date(),
    });
    const service = new TenantContextService(repo);
    const controller = new TenantContextController(service);

    const bearerReq = {
      tenantAuthContext: {
        authType: 'bearer' as const,
        tenantId: 'ten_pos',
        userId: 'usr_asep',
        activeOrganizationId: 'org_warung',
      },
    } as never;

    await expect(
      controller.getOrganization(bearerReq, 'org_other_pos'),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      controller.listOrganizationMembers(bearerReq, 'org_other_pos', {}),
    ).rejects.toThrow(ForbiddenException);

    // Member sendiri tetap diizinkan
    const ownOrg = await controller.getOrganization(bearerReq, 'org_warung');
    expect(ownOrg.id).toBe('org_warung');

    // api_key bersifat tenant-scoped M2M dan dapat membaca org mana pun di tenant-nya
    const apiKeyReq = {
      tenantAuthContext: {
        authType: 'api_key' as const,
        tenantId: 'ten_pos',
        userId: 'usr_asep',
        activeOrganizationId: null,
        apiKeyId: 'key_pos_1',
      },
    } as never;
    const otherOrgViaApiKey = await controller.getOrganization(
      apiKeyReq,
      'org_other_pos',
    );
    expect(otherOrgViaApiKey.id).toBe('org_other_pos');
  });

  it('should verify tenantId via findApiKeyRecord when verifyResult.key.tenantId is undefined', async () => {
    const { repo } = createInMemoryRepo();
    const service = new TenantContextService(repo);
    const crypto = await import('node:crypto');

    const posRawKey = 'ak_live_pos_no_tenant_field';
    const posHash = crypto
      .createHash('sha256')
      .update(posRawKey)
      .digest('base64url');

    const bimaRawKey = 'ak_live_bima_no_tenant_field';
    const bimaHash = crypto
      .createHash('sha256')
      .update(bimaRawKey)
      .digest('base64url');

    repo.findApiKeyByHashedKey = (hashed) => {
      if (hashed === posHash) {
        return Promise.resolve({
          id: 'key_pos_undef',
          tenantId: 'ten_pos',
          referenceId: 'usr_asep',
          key: posHash,
          enabled: true,
          expiresAt: null,
        });
      }
      if (hashed === bimaHash) {
        return Promise.resolve({
          id: 'key_bima_undef',
          tenantId: 'ten_bima',
          referenceId: 'usr_bima',
          key: bimaHash,
          enabled: true,
          expiresAt: null,
        });
      }
      return Promise.resolve(null);
    };

    const mockAuthRegistry = {
      getForContext: () =>
        Promise.resolve({
          api: {
            verifyApiKey: ({ body }: { body: { key: string } }) =>
              Promise.resolve({
                valid: true,
                error: null,
                key: {
                  id:
                    body.key === posRawKey ? 'key_pos_undef' : 'key_bima_undef',
                  referenceId: body.key === posRawKey ? 'usr_asep' : 'usr_bima',
                  tenantId: undefined,
                },
              }),
            getSession: () => Promise.resolve(null),
          },
        }),
    };

    const guard = new TenantApiOrBearerGuard(
      mockAuthRegistry as never,
      service,
    );

    const makeExecutionContext = (headers: Record<string, string>) => {
      const req: Record<string, unknown> = { headers };
      return {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as never;
    };

    // Cross-tenant key with undefined tenantId in verifyResult -> 403
    await expect(
      TenantContextStorage.run(
        {
          tenantId: 'ten_pos',
          slug: 'pos',
          tierId: null,
          configVersion: 1,
          source: 'subdomain',
        },
        () =>
          guard.canActivate(makeExecutionContext({ 'x-api-key': bimaRawKey })),
      ),
    ).rejects.toThrow(ForbiddenException);

    // Same-tenant key with undefined tenantId in verifyResult -> allowed
    const allowed = await TenantContextStorage.run(
      {
        tenantId: 'ten_pos',
        slug: 'pos',
        tierId: null,
        configVersion: 1,
        source: 'subdomain',
      },
      () => guard.canActivate(makeExecutionContext({ 'x-api-key': posRawKey })),
    );
    expect(allowed).toBe(true);
  });
});
