import { describe, expect, it } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PlatformAuditRepository } from './platform-audit.repository';
import {
  PlatformApiKeyRepository,
  PlatformOAuthClientRepository,
  PlatformSsoProviderRepository,
} from './platform-credentials.repository';
import { PlatformSessionRepository } from './platform-session.repository';

const pgDialect = new PgDialect();

function compileSql(expr: SQL | undefined): string {
  if (!expr) return '';
  return pgDialect.sqlToQuery(expr).sql;
}

function createQueryCaptureDb() {
  const whereClauses: SQL[] = [];
  const insertedValues: Array<Record<string, unknown>> = [];

  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (clause?: SQL) => {
        if (clause) whereClauses.push(clause);
        return chain;
      },
      orderBy: () => chain,
      groupBy: () => Promise.resolve([]),
      limit: () => chain,
      offset: () => Promise.resolve([]),
      then: (resolve: (val: unknown[]) => unknown) =>
        Promise.resolve([]).then(resolve),
    };
    return chain;
  };

  const dbMock = {
    select: () => makeSelectChain(),
    update: () => ({
      set: () => ({
        where: (clause: SQL) => {
          whereClauses.push(clause);
          return Promise.resolve([]);
        },
      }),
    }),
    delete: () => ({
      where: (clause: SQL) => {
        whereClauses.push(clause);
        return {
          returning: () => Promise.resolve([]),
          then: (resolve: (val: unknown[]) => unknown) =>
            Promise.resolve([]).then(resolve),
        };
      },
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        insertedValues.push(val);
        return {
          returning: () => Promise.resolve([val]),
          then: (resolve: (val: unknown) => unknown) =>
            Promise.resolve().then(resolve),
        };
      },
    }),
  } as any;

  return { dbMock, whereClauses, insertedValues };
}

describe('PlatformConsole Repositories tenant_id IS NULL isolation', () => {
  it('should filter by tenant_id IS NULL in PlatformSessionRepository', async () => {
    const { dbMock, whereClauses } = createQueryCaptureDb();
    const repo = new PlatformSessionRepository(dbMock);

    await repo.listPaginated({ page: 0, pageSize: 10 });
    await repo.findById('sess_1');
    await repo.deleteById('sess_1');
    await repo.deleteByUserId('usr_1');
    await repo.deleteExpired();
    await repo.countActive();
    await repo.countCreatedByDay(new Date());

    expect(whereClauses.length).toBeGreaterThanOrEqual(7);
    for (const clause of whereClauses) {
      expect(compileSql(clause)).toContain('"tenant_id" is null');
    }
  });

  it('should filter by tenant_id IS NULL in PlatformApiKeyRepository', async () => {
    const { dbMock, whereClauses } = createQueryCaptureDb();
    const repo = new PlatformApiKeyRepository(dbMock);

    await repo.listPaginated({ page: 0, pageSize: 10 });
    await repo.findById('key_1');
    await repo.updateEnabled('key_1', false);
    await repo.deleteById('key_1');

    expect(whereClauses.length).toBeGreaterThanOrEqual(5);
    for (const clause of whereClauses) {
      expect(compileSql(clause)).toContain('"apikey"."tenant_id" is null');
    }
  });

  it('should enforce tenant_id IS NULL in PlatformOAuthClientRepository & PlatformSsoProviderRepository', async () => {
    const { dbMock, whereClauses, insertedValues } = createQueryCaptureDb();
    const oauthRepo = new PlatformOAuthClientRepository(dbMock);
    const ssoRepo = new PlatformSsoProviderRepository(dbMock);

    await oauthRepo.listPaginated({ page: 0, pageSize: 10 });
    await oauthRepo.create({
      id: 'id_1',
      clientId: 'cid_1',
      clientSecret: null,
      name: 'Platform App',
      redirectUris: ['https://app.example.com/cb'],
      scopes: ['openid'],
      requirePKCE: true,
      tokenEndpointAuthMethod: 'none',
      applicationType: 'public',
      userId: null,
      metadata: null,
    });
    await oauthRepo.deleteById('id_1');

    await ssoRepo.listAllWithOrgNames();
    await ssoRepo.create({
      id: 'sso_1',
      providerId: 'okta',
      issuer: 'https://okta.example.com',
      domain: 'example.com',
      userId: null,
      samlConfig: null,
      oidcConfig: null,
    });
    await ssoRepo.deleteById('sso_1');

    expect(insertedValues[0]?.tenantId).toBeNull();
    expect(insertedValues[1]?.tenantId).toBeNull();
    expect(whereClauses.length).toBeGreaterThanOrEqual(5);
    for (const clause of whereClauses) {
      expect(compileSql(clause)).toContain('"tenant_id" is null');
    }
  });

  it('should enforce tenant_id IS NULL in PlatformAuditRepository', async () => {
    const { dbMock, whereClauses, insertedValues } = createQueryCaptureDb();
    const repo = new PlatformAuditRepository(dbMock);

    await repo.create({
      moduleKey: 'platform-console',
      actorId: 'usr_1',
      category: 'config',
      severity: 'info',
      actorEmail: 'admin@authcore.io',
      actorRole: 'super_admin',
      target: 'auth-config',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      action: 'config.updated',
      entityType: 'config',
      entityId: 'auth',
      metadata: {},
    });
    await repo.listPaginated({ limit: 10 });
    await repo.listRecent(5);
    await repo.countSince(new Date());
    await repo.countCreatedByDay(new Date());

    expect(insertedValues[0]?.tenantId).toBeNull();
    expect(whereClauses.length).toBeGreaterThanOrEqual(5);
    for (const clause of whereClauses) {
      expect(compileSql(clause)).toContain('"tenant_id" is null');
    }
  });
});
