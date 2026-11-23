import 'reflect-metadata';
import * as crypto from 'node:crypto';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { describe, expect, it, mock } from 'bun:test';
import { BusinessError } from '@/common/errors/business-error';
import * as schema from '@/database/schema';
import type {
  OAuthClient,
  Tenant,
  TenantBillingRecord,
} from '@/database/schema';
import {
  CreatePortalOAuthClientDto,
  CreatePortalTenantDto,
  UpdatePortalTenantDto,
} from '../dto/customer-portal.dto';
import { TenantOwnerGuard } from '../guards/tenant-owner.guard';
import type { IPortalOAuthClientRepository } from '../interfaces/portal-oauth-client-repository.interface';
import { PortalOAuthClientRepository } from '../repositories/portal-oauth-client.repository';
import { CustomerPortalService } from './customer-portal.service';

describe('CustomerPortalModule (TenantOwnerGuard & CustomerPortalService)', () => {
  const makeTenantRow = (overrides: Partial<Tenant> = {}): Tenant => ({
    id: 'ten_1',
    name: 'Acme Corp',
    slug: 'acme',
    ownerUserId: 'usr_owner',
    tierId: 'tier_free',
    status: 'active',
    billingStatus: 'active',
    configVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  const makeOAuthClientRow = (
    overrides: Partial<OAuthClient> = {},
  ): OAuthClient => ({
    id: 'oa_1',
    tenantId: 'ten_1',
    clientId: 'my_app_1234abcd',
    clientSecret: 'hashed_secret',
    clientDiscoveryId: null,
    disabled: false,
    skipConsent: false,
    enableEndSession: false,
    subjectType: null,
    scopes: ['openid', 'profile', 'email'],
    clientCredentialsScopes: null,
    userId: 'usr_owner',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    name: 'My App',
    uri: null,
    icon: null,
    contacts: null,
    tos: null,
    policy: null,
    softwareId: null,
    softwareVersion: null,
    softwareStatement: null,
    redirectUris: ['https://acme.example.com/callback'],
    postLogoutRedirectUris: null,
    backchannelLogoutUri: null,
    backchannelLogoutSessionRequired: null,
    tokenEndpointAuthMethod: 'client_secret_basic',
    applicationType: 'web',
    jwks: null,
    jwksUri: null,
    grantTypes: null,
    responseTypes: null,
    requirePKCE: true,
    dpopBoundAccessTokens: null,
    referenceId: null,
    metadata: { clientType: 'oidc-confidential' },
    ...overrides,
  });

  const makeBillingRecord = (
    overrides: Partial<TenantBillingRecord> = {},
  ): TenantBillingRecord => ({
    id: 'bill_1',
    tenantId: 'ten_1',
    tierId: 'tier_business',
    status: 'paid',
    amount: 499000,
    currency: 'IDR',
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-12-01T00:00:00Z'),
    note: 'Invoice November 2026',
    recordedBy: 'usr_admin',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  });

  const createExecutionContext = (
    session: unknown,
    params: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class DummyController {},
      switchToHttp: () => ({
        getRequest: () => ({ session, params }),
      }),
    }) as unknown as ExecutionContext;

  const createDbMock = (userRows: Array<{ tenantId: string | null }>) =>
    ({
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve(userRows.slice(0, 1))),
          })),
        })),
      })),
    }) as any;

  describe('TenantOwnerGuard', () => {
    it('should reject unauthenticated requests or missing user.id with 401 UnauthorizedException', async () => {
      const tenantService = {
        getTenantById: mock(() => Promise.resolve(makeTenantRow())),
      } as any;
      const db = createDbMock([]);
      const guard = new TenantOwnerGuard(tenantService, db);

      await expect(
        guard.canActivate(createExecutionContext(null, { tenantId: 'ten_1' })),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        guard.canActivate(createExecutionContext({}, { tenantId: 'ten_1' })),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        guard.canActivate(
          createExecutionContext({ user: {} }, { tenantId: 'ten_1' }),
        ),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        guard.canActivate(
          createExecutionContext(
            { user: { tenantId: null } },
            { tenantId: 'ten_1' },
          ),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject tenant users (session.user.tenantId !== null) with 403 ForbiddenException', async () => {
      const tenantService = {
        getTenantById: mock(() => Promise.resolve(makeTenantRow())),
      } as any;
      const db = createDbMock([]);
      const guard = new TenantOwnerGuard(tenantService, db);

      const ctx = createExecutionContext(
        { user: { id: 'usr_owner', tenantId: 'ten_1' } },
        { tenantId: 'ten_1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      expect(db.select).not.toHaveBeenCalled();
      expect(tenantService.getTenantById).not.toHaveBeenCalled();
    });

    it('should fail closed when session.user.tenantId is undefined and DB user has tenantId or is missing', async () => {
      const tenantService = {
        getTenantById: mock(() => Promise.resolve(makeTenantRow())),
      } as any;

      const tenantDbGuard = new TenantOwnerGuard(
        tenantService,
        createDbMock([{ tenantId: 'ten_other' }]),
      );
      await expect(
        tenantDbGuard.canActivate(
          createExecutionContext(
            { user: { id: 'usr_owner' } },
            { tenantId: 'ten_1' },
          ),
        ),
      ).rejects.toThrow(ForbiddenException);

      const missingUserGuard = new TenantOwnerGuard(
        tenantService,
        createDbMock([]),
      );
      await expect(
        missingUserGuard.canActivate(
          createExecutionContext(
            { user: { id: 'usr_missing' } },
            { tenantId: 'ten_1' },
          ),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow when session.user.tenantId is undefined, DB user has tenantId === null, and user owns the tenant', async () => {
      const tenantService = {
        getTenantById: mock(() =>
          Promise.resolve(makeTenantRow({ ownerUserId: 'usr_owner' })),
        ),
      } as any;
      const guard = new TenantOwnerGuard(
        tenantService,
        createDbMock([{ tenantId: null }]),
      );

      const ctx = createExecutionContext(
        { user: { id: 'usr_owner' } },
        { tenantId: 'ten_1' },
      );

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('should reject when tenant.ownerUserId !== session.user.id with 403 ForbiddenException', async () => {
      const tenantService = {
        getTenantById: mock(() =>
          Promise.resolve(makeTenantRow({ ownerUserId: 'usr_other_owner' })),
        ),
      } as any;
      const guard = new TenantOwnerGuard(tenantService, createDbMock([]));

      const ctx = createExecutionContext(
        { user: { id: 'usr_owner', tenantId: null } },
        { tenantId: 'ten_1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('should allow collection routes without tenantId param for verified platform users', async () => {
      const tenantService = {
        getTenantById: mock(() => Promise.resolve(makeTenantRow())),
      } as any;
      const guard = new TenantOwnerGuard(tenantService, createDbMock([]));

      const ctx = createExecutionContext({
        user: { id: 'usr_owner', tenantId: null },
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(tenantService.getTenantById).not.toHaveBeenCalled();
    });
  });

  describe('CustomerPortalDto Validation', () => {
    const validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it('should reject tierId, status, ownerUserId, billingStatus, and whitespace-only strings on CreatePortalTenantDto', async () => {
      for (const extraField of [
        { name: 'Acme', slug: 'acme', tierId: 'tier_enterprise' },
        { name: 'Acme', slug: 'acme', status: 'active' },
        { name: 'Acme', slug: 'acme', ownerUserId: 'usr_other' },
        { name: 'Acme', slug: 'acme', billingStatus: 'active' },
      ]) {
        await expect(
          validationPipe.transform(extraField, {
            type: 'body',
            metatype: CreatePortalTenantDto,
          }),
        ).rejects.toThrow(BadRequestException);
      }

      await expect(
        validationPipe.transform(
          { name: '   ', slug: 'acme' },
          { type: 'body', metatype: CreatePortalTenantDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        validationPipe.transform(
          { name: 'Acme', slug: '   ' },
          { type: 'body', metatype: CreatePortalTenantDto },
        ),
      ).rejects.toThrow(BadRequestException);

      const valid = (await validationPipe.transform(
        { name: '  Acme Corp  ', slug: '  acme-corp  ' },
        { type: 'body', metatype: CreatePortalTenantDto },
      )) as CreatePortalTenantDto;
      expect(valid.name).toBe('Acme Corp');
      expect(valid.slug).toBe('acme-corp');
    });

    it('should validate redirectUris, scopes, and non-blank name on CreatePortalOAuthClientDto', async () => {
      const invalidPayloads = [
        {
          name: '   ',
          type: 'oidc-confidential',
          redirectUris: ['https://app.example.com/cb'],
          scopes: ['openid'],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: [],
          scopes: ['openid'],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: ['not-a-uri'],
          scopes: ['openid'],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: ['javascript:alert(1)'],
          scopes: ['openid'],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: ['data:text/html,<script>alert(1)</script>'],
          scopes: ['openid'],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: ['vbscript:msgbox(1)'],
          scopes: ['openid'],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: ['https://app.example.com/cb'],
          scopes: [],
          pkceRequired: true,
        },
        {
          name: 'App',
          type: 'oidc-confidential',
          redirectUris: ['https://app.example.com/cb'],
          scopes: ['   '],
          pkceRequired: true,
        },
      ];

      for (const payload of invalidPayloads) {
        await expect(
          validationPipe.transform(payload, {
            type: 'body',
            metatype: CreatePortalOAuthClientDto,
          }),
        ).rejects.toThrow(BadRequestException);
      }

      const accepted = (await validationPipe.transform(
        {
          name: '  Valid Client  ',
          type: 'oidc-public',
          redirectUris: [
            'https://app.example.com/cb',
            'http://localhost:3000/cb',
            'myapp://callback',
          ],
          scopes: [' openid ', 'profile'],
          pkceRequired: true,
        },
        { type: 'body', metatype: CreatePortalOAuthClientDto },
      )) as CreatePortalOAuthClientDto;

      expect(accepted.name).toBe('Valid Client');
      expect(accepted.redirectUris).toEqual([
        'https://app.example.com/cb',
        'http://localhost:3000/cb',
        'myapp://callback',
      ]);
      expect(accepted.scopes).toEqual(['openid', 'profile']);
    });
  });

  describe('PortalOAuthClientRepository.createWithQuotaCheck', () => {
    const createRepoTxMock = (opts: {
      lockedTenants?: Array<{ id: string }>;
      oauthCount?: number;
      createdRow?: OAuthClient;
    }) => {
      const forMock = mock(() =>
        Promise.resolve(opts.lockedTenants ?? [{ id: 'ten_1' }]),
      );
      const txInsertValuesMock = mock(() => ({
        returning: mock(() =>
          Promise.resolve([opts.createdRow ?? makeOAuthClientRow()]),
        ),
      }));

      const tx = {
        select: mock(() => ({
          from: mock((table: unknown) => {
            if (table === schema.tenant) {
              return {
                where: mock(() => ({
                  for: forMock,
                })),
              };
            }
            return {
              where: mock(() =>
                Promise.resolve([{ total: opts.oauthCount ?? 0 }]),
              ),
            };
          }),
        })),
        insert: mock(() => ({
          values: txInsertValuesMock,
        })),
      };

      const db = {
        transaction: mock((cb: (txArg: typeof tx) => Promise<unknown>) =>
          cb(tx),
        ),
      } as any;

      return { db, tx, forMock, txInsertValuesMock };
    };

    it('should lock tenant row with FOR UPDATE and reject with 403 TIER_CLIENT_LIMIT_REACHED inside transaction when quota reached', async () => {
      const { db, tx, forMock } = createRepoTxMock({
        lockedTenants: [{ id: 'ten_1' }],
        oauthCount: 1,
      });
      const repo = new PortalOAuthClientRepository(db);

      let caught: unknown;
      try {
        await repo.createWithQuotaCheck(
          {
            id: 'oa_2',
            tenantId: 'ten_1',
            clientId: 'second_1234',
            clientSecret: 'hash',
            name: 'Second',
            redirectUris: ['https://app.example.com/cb'],
            scopes: ['openid'],
            requirePKCE: true,
            tokenEndpointAuthMethod: 'client_secret_basic',
            applicationType: 'web',
            userId: 'usr_owner',
            metadata: { clientType: 'oidc-confidential' },
          },
          1,
        );
      } catch (err) {
        caught = err;
      }

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(forMock).toHaveBeenCalledWith('update');
      expect(tx.insert).not.toHaveBeenCalled();
      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(403);
      expect((caught as BusinessError).code).toBe('TIER_CLIENT_LIMIT_REACHED');
    });

    it('should insert OAuth client inside the same transaction when under quota or unlimited', async () => {
      const { db, tx, forMock } = createRepoTxMock({
        lockedTenants: [{ id: 'ten_1' }],
        oauthCount: 0,
      });
      const repo = new PortalOAuthClientRepository(db);

      const created = await repo.createWithQuotaCheck(
        {
          id: 'oa_1',
          tenantId: 'ten_1',
          clientId: 'first_1234',
          clientSecret: 'hash',
          name: 'First',
          redirectUris: ['https://app.example.com/cb'],
          scopes: ['openid'],
          requirePKCE: true,
          tokenEndpointAuthMethod: 'client_secret_basic',
          applicationType: 'web',
          userId: 'usr_owner',
          metadata: { clientType: 'oidc-confidential' },
        },
        1,
      );

      expect(forMock).toHaveBeenCalledWith('update');
      expect(tx.insert).toHaveBeenCalledTimes(1);
      expect(created.id).toBe('oa_1');
    });
  });

  describe('CustomerPortalService', () => {
    const createServiceMocks = (tenantOverrides: Partial<Tenant> = {}) => {
      const createdClients: Array<{
        record: any;
        maxClients: number | undefined;
      }> = [];
      const tenantRow = makeTenantRow(tenantOverrides);

      const tenantService = {
        listTenants: mock((q) =>
          Promise.resolve({
            items: [tenantRow],
            total: 1,
            page: q.page,
            pageSize: q.pageSize,
          }),
        ),
        getTenantById: mock(() => Promise.resolve(tenantRow)),
        createTenant: mock((input) =>
          Promise.resolve(
            makeTenantRow({
              name: input.name,
              slug: input.slug,
              ownerUserId: input.ownerUserId,
              tierId: input.tierId ?? 'tier_free',
            }),
          ),
        ),
        updateTenant: mock((id, input) => {
          if (input.slug !== undefined) {
            return Promise.reject(
              BusinessError.badRequest(
                'Slug tenant bersifat immutable dan tidak dapat diubah.',
                'TENANT_SLUG_IMMUTABLE',
                { tenantId: id },
              ),
            );
          }
          return Promise.resolve(
            makeTenantRow({ ...tenantRow, name: input.name ?? tenantRow.name }),
          );
        }),
      } as any;

      const billingService = {
        listRecords: mock(() =>
          Promise.resolve({
            items: [makeBillingRecord()],
            total: 1,
            page: 0,
            pageSize: 10,
          }),
        ),
      } as any;

      const oauthRepo: IPortalOAuthClientRepository = {
        listByTenantPaginated: mock(() =>
          Promise.resolve({
            items: [makeOAuthClientRow()],
            total: 1,
          }),
        ),
        createWithQuotaCheck: mock((record, maxClients) => {
          createdClients.push({ record, maxClients });
          return Promise.resolve(
            makeOAuthClientRow({
              id: record.id,
              tenantId: record.tenantId,
              clientId: record.clientId,
              clientSecret: record.clientSecret,
              name: record.name,
              redirectUris: record.redirectUris,
              scopes: record.scopes,
              requirePKCE: record.requirePKCE,
              tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
              applicationType: record.applicationType,
              userId: record.userId,
              metadata: record.metadata,
            }),
          );
        }),
        deleteByTenantAndId: mock(() => Promise.resolve(true)),
      };

      const service = new CustomerPortalService(
        tenantService,
        billingService,
        oauthRepo,
      );

      return {
        service,
        tenantService,
        billingService,
        oauthRepo,
        createdClients,
      };
    };

    it('should list only tenants owned by the actor with clamped pagination', async () => {
      const { service, tenantService } = createServiceMocks();

      const res = await service.listOwnedTenants('usr_owner', {
        page: -2,
        pageSize: 500,
        search: 'acme',
      });

      expect(res.page).toBe(0);
      expect(res.pageSize).toBe(100);
      expect(tenantService.listTenants).toHaveBeenCalledWith({
        page: 0,
        pageSize: 100,
        search: 'acme',
        status: undefined,
        ownerUserId: 'usr_owner',
      });

      const resDefault = await service.listOwnedTenants('usr_owner', {
        page: -1,
        pageSize: -5,
      });
      expect(resDefault.page).toBe(0);
      expect(resDefault.pageSize).toBe(10);
    });

    it('should create tenant owned by session actor always locked to tier_free', async () => {
      const { service, tenantService } = createServiceMocks();

      const created = await service.createTenant('usr_owner', {
        name: 'Acme Inc',
        slug: 'acme-inc',
      });

      expect(created.ownerUserId).toBe('usr_owner');
      expect(created.tierId).toBe('tier_free');
      expect(tenantService.createTenant).toHaveBeenCalledWith({
        name: 'Acme Inc',
        slug: 'acme-inc',
        ownerUserId: 'usr_owner',
        tierId: 'tier_free',
      });
    });

    it('should reject slug updates with 400 TENANT_SLUG_IMMUTABLE and allow slug through ValidationPipe on UpdatePortalTenantDto', async () => {
      const { service } = createServiceMocks();

      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });

      const transformed = (await pipe.transform(
        { name: 'Acme Renamed', slug: 'new-slug' },
        { type: 'body', metatype: UpdatePortalTenantDto },
      )) as UpdatePortalTenantDto;

      expect(transformed.slug).toBe('new-slug');

      let caught: unknown;
      try {
        await service.updateTenant('ten_1', transformed);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(400);
      expect((caught as BusinessError).code).toBe('TENANT_SLUG_IMMUTABLE');

      await expect(
        pipe.transform(
          { tierId: 'tier_enterprise' },
          { type: 'body', metatype: UpdatePortalTenantDto },
        ),
      ).rejects.toThrow();
    });

    it('should set oauth_client.tenantId, hash clientSecret with SHA-256 base64url, deduplicate scopes, and return plainClientSecret once', async () => {
      const { service, createdClients } = createServiceMocks({
        tierId: 'tier_free',
      });

      const confidential = await service.createTenantOAuthClient(
        'ten_1',
        'usr_owner',
        {
          name: 'Customer Web App',
          type: 'oidc-confidential',
          redirectUris: [' https://app.acme.test/callback '],
          scopes: [' openid ', 'profile', 'openid', 'email'],
          pkceRequired: true,
        },
      );

      expect(confidential.tenantId).toBe('ten_1');
      expect(confidential.plainClientSecret).toBeDefined();
      expect(createdClients[0].maxClients).toBe(1);
      expect(createdClients[0].record.tenantId).toBe('ten_1');
      expect(createdClients[0].record.userId).toBe('usr_owner');
      expect(createdClients[0].record.redirectUris).toEqual([
        'https://app.acme.test/callback',
      ]);
      expect(createdClients[0].record.scopes).toEqual([
        'openid',
        'profile',
        'email',
      ]);

      const expectedHash = crypto
        .createHash('sha256')
        .update(confidential.plainClientSecret!)
        .digest('base64url');
      expect(createdClients[0].record.clientSecret).toBe(expectedHash);

      const { service: bizService, createdClients: bizClients } =
        createServiceMocks({ tierId: 'tier_business' });

      const pub = await bizService.createTenantOAuthClient(
        'ten_1',
        'usr_owner',
        {
          name: 'Customer SPA',
          type: 'oidc-public',
          redirectUris: ['https://spa.acme.test/callback'],
          scopes: ['openid'],
          pkceRequired: true,
        },
      );

      expect(bizClients[0].maxClients).toBeUndefined();
      expect(bizClients[0].record.clientSecret).toBeNull();
      expect(pub.plainClientSecret).toBeUndefined();
    });

    it('should pass maxClients=1 on Free tier and propagate 403 TIER_CLIENT_LIMIT_REACHED', async () => {
      const { service, oauthRepo } = createServiceMocks({
        tierId: 'tier_free',
      });
      (
        oauthRepo.createWithQuotaCheck as ReturnType<typeof mock>
      ).mockRejectedValue(
        BusinessError.forbidden(
          'Tier Free hanya mengizinkan maksimal 1 OAuth client per tenant.',
          'TIER_CLIENT_LIMIT_REACHED',
          { tenantId: 'ten_1', limit: 1 },
        ),
      );

      let caught: unknown;
      try {
        await service.createTenantOAuthClient('ten_1', 'usr_owner', {
          name: 'Second App',
          type: 'oidc-confidential',
          redirectUris: ['https://second.acme.test/callback'],
          scopes: ['openid'],
          pkceRequired: true,
        });
      } catch (err) {
        caught = err;
      }

      expect(oauthRepo.createWithQuotaCheck).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'ten_1' }),
        1,
      );
      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(403);
      expect((caught as BusinessError).code).toBe('TIER_CLIENT_LIMIT_REACHED');
    });

    it('should allow creating OAuth clients with undefined maxClients on paid tiers', async () => {
      const { service, oauthRepo } = createServiceMocks({
        tierId: 'tier_business',
      });

      const created = await service.createTenantOAuthClient(
        'ten_1',
        'usr_owner',
        {
          name: 'Fourth App',
          type: 'mcp-client',
          redirectUris: ['https://mcp.acme.test/callback'],
          scopes: ['openid'],
          pkceRequired: true,
        },
      );

      expect(created.tenantId).toBe('ten_1');
      expect(created.plainClientSecret).toBeDefined();
      expect(oauthRepo.createWithQuotaCheck).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'ten_1' }),
        undefined,
      );
    });

    it('should scope OAuth client deletion to tenantId and throw 404 on cross-tenant IDOR attempt', async () => {
      const { service, oauthRepo } = createServiceMocks();
      (
        oauthRepo.deleteByTenantAndId as ReturnType<typeof mock>
      ).mockResolvedValue(false);

      let caught: unknown;
      try {
        await service.deleteTenantOAuthClient('ten_1', 'oa_from_ten_2');
      } catch (err) {
        caught = err;
      }

      expect(oauthRepo.deleteByTenantAndId).toHaveBeenCalledWith(
        'ten_1',
        'oa_from_ten_2',
      );
      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(404);
    });

    it('should return read-only tenant billing summary and clamped billing records', async () => {
      const { service, billingService } = createServiceMocks({
        tierId: 'tier_business',
        billingStatus: 'manual_invoice',
      });

      const billing = await service.getTenantBilling('ten_1', {
        page: -1,
        pageSize: 300,
      });

      expect(billing.tenantId).toBe('ten_1');
      expect(billing.tierId).toBe('tier_business');
      expect(billing.billingStatus).toBe('manual_invoice');
      expect(billing.items).toHaveLength(1);
      expect(billingService.listRecords).toHaveBeenCalledWith({
        tenantId: 'ten_1',
        page: 0,
        pageSize: 100,
        status: undefined,
      });
    });

    it('should list tenant OAuth clients with clamped pagination without exposing clientSecret', async () => {
      const { service, oauthRepo } = createServiceMocks();

      const res = await service.listTenantOAuthClients('ten_1', {
        page: -3,
        pageSize: 250,
        search: 'my',
      });

      expect(res.page).toBe(0);
      expect(res.pageSize).toBe(100);
      expect(res.items).toHaveLength(1);
      expect(
        (res.items[0] as Record<string, unknown>).clientSecret,
      ).toBeUndefined();
      expect(oauthRepo.listByTenantPaginated).toHaveBeenCalledWith({
        tenantId: 'ten_1',
        page: 0,
        pageSize: 100,
        search: 'my',
      });
    });
  });
});
