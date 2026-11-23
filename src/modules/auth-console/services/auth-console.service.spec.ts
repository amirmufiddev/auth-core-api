import * as crypto from 'node:crypto';
import * as argon2 from 'argon2';
import { describe, expect, it, mock } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as schema from '@/database/schema';
import { AuthConsoleService } from './auth-console.service';

describe('AuthConsoleService', () => {
  const createConfigMock = () =>
    ({
      get: mock((key: string) => {
        if (key === 'app') return { appName: 'Auth Core' };
        if (key === 'auth.clientUrl') return 'http://localhost:2000';
        return undefined;
      }),
    }) as any;

  const createFeatureConfigMock = () =>
    ({
      assertFeatureEnabled: mock(() => {}),
      isFeatureEnabled: mock(() => false),
    }) as any;

  const actor = {
    id: 'usr_1',
    email: 'admin@authcore.io',
    role: 'super_admin',
  };

  it('should block deleting system roles in deleteRole', async () => {
    const dbMock = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: 'role_super_admin',
                  slug: 'super_admin',
                  isSystem: true,
                },
              ]),
          }),
        }),
      }),
    } as any;

    const featureConfigMock = {
      assertFeatureEnabled: mock(() => {}),
      isFeatureEnabled: mock(() => true),
    } as any;

    const service = new AuthConsoleService(
      dbMock,
      featureConfigMock,
      { send: mock(() => Promise.resolve()) } as any,
      createConfigMock(),
    );

    await expect(service.deleteRole('role_super_admin', actor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should enforce feature flag gating in listApiKeys', async () => {
    const featureConfigMock = {
      assertFeatureEnabled: mock(() => {
        throw new ForbiddenException('FEATURE_DISABLED');
      }),
    } as any;

    const service = new AuthConsoleService(
      {} as any,
      featureConfigMock,
      { send: mock(() => Promise.resolve()) } as any,
      createConfigMock(),
    );

    await expect(
      service.listApiKeys({ page: 0, pageSize: 10 }),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('Organization IDOR protection', () => {
    const orgRow = {
      id: 'org_1',
      name: 'Org One',
      slug: 'org-one',
      metadata: JSON.stringify({ ssoEnabled: false }),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    const makeOrgDbMock = (returningRows: unknown[]) => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([orgRow]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(returningRows),
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve(returningRows),
        }),
      }),
    });

    it('should throw NotFoundException in updateOrganizationMemberRole when member does not belong to org', async () => {
      const service = new AuthConsoleService(
        makeOrgDbMock([]) as any,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      await expect(
        service.updateOrganizationMemberRole('org_1', 'mem_other_org', {
          role: 'admin',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException in removeOrganizationMember when member does not belong to org', async () => {
      const service = new AuthConsoleService(
        makeOrgDbMock([]) as any,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      await expect(
        service.removeOrganizationMember('org_1', 'mem_other_org'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException in cancelOrganizationInvitation when invitation does not belong to org', async () => {
      const service = new AuthConsoleService(
        makeOrgDbMock([]) as any,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      await expect(
        service.cancelOrganizationInvitation('org_1', 'inv_other_org'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createUser password security', () => {
    it('should generate a random password instead of hardcoded Admin12345! when password is omitted', async () => {
      const insertedAccounts: Array<Record<string, unknown>> = [];
      const txMock = {
        insert: (table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            if (table === schema.account) {
              insertedAccounts.push(vals);
            }
            return Promise.resolve();
          },
        }),
      };

      const dbMock = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
        transaction: (cb: (tx: typeof txMock) => Promise<void>) => cb(txMock),
      } as any;

      const service = new AuthConsoleService(
        dbMock,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      await service.createUser(
        {
          name: 'Alice',
          email: 'alice@example.com',
          role: 'user',
          emailVerified: true,
          twoFactorEnabled: false,
        },
        actor,
      );

      expect(insertedAccounts).toHaveLength(1);
      const hashed = String(insertedAccounts[0].password);
      expect(await argon2.verify(hashed, 'Admin12345!')).toBe(false);
    });
  });

  describe('createOAuthClient secret hashing', () => {
    it('should hash clientSecret before storing and return plainClientSecret once for confidential clients', async () => {
      const insertedClients: Array<Record<string, unknown>> = [];
      const dbMock = {
        insert: () => ({
          values: (vals: Record<string, unknown>) => {
            insertedClients.push(vals);
            return {
              returning: () =>
                Promise.resolve([
                  {
                    ...vals,
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                  },
                ]),
            };
          },
        }),
      } as any;

      const service = new AuthConsoleService(
        dbMock,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      const res = await service.createOAuthClient(
        {
          name: 'Partner Portal',
          type: 'oidc-confidential',
          redirectUris: ['https://partner.example.com/callback'],
          scopes: ['openid', 'profile'],
          pkceRequired: true,
        },
        actor,
      );

      expect(insertedClients).toHaveLength(1);
      const storedSecret = String(insertedClients[0].clientSecret);
      expect(res.plainClientSecret).toBeDefined();
      expect(storedSecret).not.toBe(res.plainClientSecret);
      const expectedHash = crypto
        .createHash('sha256')
        .update(res.plainClientSecret!)
        .digest('base64url');
      expect(storedSecret).toBe(expectedHash);
    });

    it('should store null clientSecret and omit plainClientSecret for oidc-public clients', async () => {
      const insertedClients: Array<Record<string, unknown>> = [];
      const dbMock = {
        insert: () => ({
          values: (vals: Record<string, unknown>) => {
            insertedClients.push(vals);
            return {
              returning: () =>
                Promise.resolve([
                  {
                    ...vals,
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                  },
                ]),
            };
          },
        }),
      } as any;

      const service = new AuthConsoleService(
        dbMock,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      const res = await service.createOAuthClient(
        {
          name: 'Mobile SPA',
          type: 'oidc-public',
          redirectUris: ['myapp://callback'],
          scopes: ['openid'],
          pkceRequired: true,
        },
        actor,
      );

      expect(insertedClients[0].clientSecret).toBeNull();
      expect(
        (res as { plainClientSecret?: string }).plainClientSecret,
      ).toBeUndefined();
    });
  });

  describe('Organization plan metadata removal', () => {
    it('should not include plan in created organization metadata or hydrated response', async () => {
      const insertedOrgs: Array<Record<string, unknown>> = [];
      const createdRow = {
        id: 'org_new',
        tenantId: 'ten_platform_default',
        name: 'Acme',
        slug: 'acme',
        metadata: JSON.stringify({ ssoEnabled: true }),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };

      const dbMock = {
        select: () => ({
          from: () => ({
            where: () => {
              const arrPromise = Promise.resolve([]) as Promise<unknown[]> & {
                limit: () => Promise<unknown[]>;
              };
              arrPromise.limit = () => Promise.resolve([]);
              return arrPromise;
            },
            innerJoin: () => ({
              where: () => Promise.resolve([]),
            }),
          }),
        }),
        insert: (table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            if (table === schema.organization) {
              insertedOrgs.push(vals);
              return {
                returning: () => Promise.resolve([createdRow]),
              };
            }
            return Promise.resolve();
          },
        }),
      } as any;

      const service = new AuthConsoleService(
        dbMock,
        createFeatureConfigMock(),
        { send: mock(() => Promise.resolve()) } as any,
        createConfigMock(),
      );

      const org = await service.createOrganization(
        {
          name: 'Acme',
          slug: 'acme',
          ssoEnabled: true,
        } as any,
        actor,
      );

      expect(insertedOrgs).toHaveLength(1);
      expect(JSON.parse(String(insertedOrgs[0].metadata))).toEqual({
        ssoEnabled: true,
      });
      expect('plan' in org).toBe(false);
    });
  });
});
