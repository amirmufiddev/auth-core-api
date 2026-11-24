import { describe, expect, it, mock } from 'bun:test';
import * as schema from '@/database/schema';
import { DrizzleSocialBridgeRepository } from './social-bridge.repository';

describe('DrizzleSocialBridgeRepository', () => {
  function createRepo(options: {
    tenantRow?: { tierId: string | null; status: string } | null;
    resolved?: {
      configMap: Record<
        string,
        { enabled: boolean; settings?: Record<string, unknown> }
      >;
      decryptedSecrets?: Record<string, Record<string, string>>;
    };
  }) {
    const resolveForTenant = mock(() =>
      Promise.resolve(
        options.resolved ?? {
          configMap: {},
          decryptedSecrets: {},
        },
      ),
    );

    const insertedUsers: Array<Record<string, unknown>> = [];
    const selectWhereArgs: unknown[] = [];

    const dbMock = {
      select: () => ({
        from: (table: unknown) => ({
          where: (predicate: unknown) => {
            selectWhereArgs.push({ table, predicate });
            return {
              limit: () => {
                if (table === schema.tenant) {
                  return Promise.resolve(
                    options.tenantRow ? [options.tenantRow] : [],
                  );
                }
                return Promise.resolve([]);
              },
            };
          },
        }),
      }),
      transaction: async (cb: (tx: any) => Promise<void>) => {
        const tx = {
          insert: (table: unknown) => ({
            values: (val: Record<string, unknown>) => {
              if (table === schema.user) {
                insertedUsers.push(val);
              }
              return Promise.resolve();
            },
          }),
        };
        await cb(tx);
      },
    } as any;

    const moduleRef = {
      get: mock(() => ({ resolveForTenant })),
    } as any;

    return {
      repo: new DrizzleSocialBridgeRepository(dbMock, moduleRef),
      resolveForTenant,
      insertedUsers,
    };
  }

  it('should return null when tenant row is missing', async () => {
    const { repo, resolveForTenant } = createRepo({ tenantRow: null });
    const creds = await repo.findTenantCredentials('ten_missing', 'google');
    expect(creds).toBeNull();
    expect(resolveForTenant).not.toHaveBeenCalled();
  });

  it('should return null when tenant status is suspended', async () => {
    const { repo, resolveForTenant } = createRepo({
      tenantRow: { tierId: 'tier_pro', status: 'suspended' },
      resolved: {
        configMap: {
          socialGoogle: {
            enabled: true,
            settings: { clientId: 'goog-client-id' },
          },
        },
        decryptedSecrets: {
          socialGoogle: { clientSecret: 'goog-client-secret' },
        },
      },
    });

    const creds = await repo.findTenantCredentials('ten_susp', 'google');
    expect(creds).toBeNull();
    expect(resolveForTenant).not.toHaveBeenCalled();
  });

  it('should return null when social provider feature is disabled even if credentials exist', async () => {
    const { repo, resolveForTenant } = createRepo({
      tenantRow: { tierId: 'tier_pro', status: 'active' },
      resolved: {
        configMap: {
          socialGoogle: {
            enabled: false,
            settings: { clientId: 'goog-client-id' },
          },
        },
        decryptedSecrets: {
          socialGoogle: { clientSecret: 'goog-client-secret' },
        },
      },
    });

    const creds = await repo.findTenantCredentials('ten_1', 'google');
    expect(creds).toBeNull();
    expect(resolveForTenant).toHaveBeenCalledWith('ten_1', 'tier_pro');
  });

  it('should return null when clientId in settings or clientSecret in decryptedSecrets is missing or blank', async () => {
    const missingClientId = createRepo({
      tenantRow: { tierId: 'tier_pro', status: 'active' },
      resolved: {
        configMap: {
          socialGoogle: { enabled: true, settings: { clientId: '   ' } },
        },
        decryptedSecrets: {
          socialGoogle: { clientSecret: 'goog-client-secret' },
        },
      },
    });
    expect(
      await missingClientId.repo.findTenantCredentials('ten_1', 'google'),
    ).toBeNull();

    const missingSecret = createRepo({
      tenantRow: { tierId: 'tier_pro', status: 'active' },
      resolved: {
        configMap: {
          socialGoogle: {
            enabled: true,
            settings: { clientId: 'goog-client-id' },
          },
        },
        decryptedSecrets: {},
      },
    });
    expect(
      await missingSecret.repo.findTenantCredentials('ten_1', 'google'),
    ).toBeNull();
  });

  it('should resolve tenant tierId, read clientId from settings and clientSecret from decryptedSecrets when active and enabled', async () => {
    const { repo, resolveForTenant } = createRepo({
      tenantRow: { tierId: 'tier_business', status: 'active' },
      resolved: {
        configMap: {
          socialGoogle: {
            enabled: true,
            settings: { clientId: '  goog-client-id  ' },
          },
        },
        decryptedSecrets: {
          socialGoogle: { clientSecret: '  goog-client-secret  ' },
        },
      },
    });

    const creds = await repo.findTenantCredentials('ten_1', 'google');
    expect(resolveForTenant).toHaveBeenCalledWith('ten_1', 'tier_business');
    expect(creds).toEqual({
      clientId: 'goog-client-id',
      clientSecret: 'goog-client-secret',
    });
  });

  it('should lowercase email defensively when creating user with account', async () => {
    const { repo, insertedUsers } = createRepo({});
    const created = await repo.createUserWithAccount({
      tenantId: 'ten_1',
      email: '  Alice.Admin@Pos.ID ',
      name: 'Alice',
      emailVerified: true,
      provider: 'google',
      providerAccountId: 'goog-123',
    });

    expect(created.email).toBe('alice.admin@pos.id');
    expect(insertedUsers[0]?.email).toBe('alice.admin@pos.id');
  });
});
