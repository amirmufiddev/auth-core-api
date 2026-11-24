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
import { TenantApiOrBearerGuard } from '../guards/tenant-api-or-bearer.guard';
import type { ITenantContextRepository } from '../interfaces/tenant-context-repository.interface';

function createInMemoryRepo(): {
  repo: ITenantContextRepository;
  state: {
    tenants: Array<{ id: string; slug: string; status: 'active' | 'suspended' }>;
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
    async findTenantStatus(tenantId) {
      return state.tenants.find((t) => t.id === tenantId)?.status ?? null;
    },
    async findUserTenantId(userId) {
      const user = state.users.find((u) => u.id === userId);
      return user ? { tenantId: user.tenantId } : null;
    },
    async findOrganizationById(organizationId) {
      return (
        state.organizations.find((o) => o.id === organizationId) ?? null
      );
    },
    async findMemberInOrganization(organizationId, userId) {
      const m = state.members.find(
        (row) =>
          row.organizationId === organizationId && row.userId === userId,
      );
      return m ? { role: m.role, tenantId: m.tenantId } : null;
    },
    async findOrganizationRolePermissions(organizationId, role) {
      const r = state.organizationRoles.find(
        (row) => row.organizationId === organizationId && row.role === role,
      );
      return r?.permission ?? null;
    },
    async findApiKeyByHashedKey(hashedKey) {
      return state.apiKeys.find((k) => k.key === hashedKey) ?? null;
    },
    async listOrganizationsForTenant(params) {
      const filtered = state.organizations.filter(
        (o) => o.tenantId === params.tenantId,
      );
      return { items: filtered, total: filtered.length };
    },
    async listOrganizationMembers(params) {
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
      return { items: filtered, total: filtered.length };
    },
  };

  return { repo, state };
}

describe('TenantContextService & POS Integration', () => {
  it('getSessionContext untuk Asep mengembalikan context lengkap dan merefleksikan pencabutan role secara real-time', async () => {
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

  it('menolak activeOrganizationId spoofing lintas tenant dengan 403 ForbiddenException', async () => {
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

  it('konfigurasi JWT Access Token untuk tenant membatasi TTL <= 900 detik (5-15 menit)', () => {
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

  it('Tenant API Key milik ten_bima ditolak (403) saat memanggil endpoint pada konteks ten_pos', async () => {
    const { repo } = createInMemoryRepo();
    const service = new TenantContextService(repo);

    const mockAuthRegistry = {
      getForContext: async (ctx: { tenantId: string | null }) => ({
        api: {
          verifyApiKey: async ({ body }: { body: { key: string } }) => {
            if (ctx.tenantId === 'ten_pos' && body.key === 'ak_live_pos_secret') {
              return {
                valid: true,
                error: null,
                key: {
                  id: 'key_pos_1',
                  referenceId: 'usr_asep',
                  tenantId: 'ten_pos',
                },
              };
            }
            return {
              valid: false,
              error: { code: 'KEY_NOT_FOUND', message: 'Not found' },
              key: null,
            };
          },
          getSession: async () => null,
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
    repo.findApiKeyByHashedKey = async (hashed) => {
      if (hashed === bimaHash) {
        return {
          id: 'key_bima_1',
          tenantId: 'ten_bima',
          referenceId: 'usr_bima',
          key: bimaHash,
          enabled: true,
          expiresAt: null,
        };
      }
      return null;
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
          guard.canActivate(
            makeExecutionContext({ 'x-api-key': bimaRawKey }),
          ),
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
});
