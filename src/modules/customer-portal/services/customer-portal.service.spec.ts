import 'reflect-metadata';
import * as crypto from 'node:crypto';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { describe, expect, it, mock } from 'bun:test';
import { BusinessError } from '@/common/errors/business-error';
import type {
  OAuthClient,
  Tenant,
  TenantBillingRecord,
} from '@/database/schema';
import { UpdatePortalTenantDto } from '../dto/customer-portal.dto';
import { TenantOwnerGuard } from '../guards/tenant-owner.guard';
import type { IPortalOAuthClientRepository } from '../interfaces/portal-oauth-client-repository.interface';
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
    it('should reject unauthenticated requests with 401 UnauthorizedException', async () => {
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

      await expect(
        missingUserGuard.canActivate(
          createExecutionContext({ user: {} }, { tenantId: 'ten_1' }),
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

  describe('CustomerPortalService', () => {
    const createServiceMocks = (tenantOverrides: Partial<Tenant> = {}) => {
      const createdClients: any[] = [];
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
        countByTenant: mock(() => Promise.resolve(0)),
        create: mock((record) => {
          createdClients.push(record);
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

    it('should create tenant owned by session actor defaulting to tier_free', async () => {
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

    it('should set oauth_client.tenantId, hash clientSecret with SHA-256 base64url, and return plainClientSecret once', async () => {
      const { service, createdClients } = createServiceMocks({
        tierId: 'tier_free',
      });

      const confidential = await service.createTenantOAuthClient(
        'ten_1',
        'usr_owner',
        {
          name: 'Customer Web App',
          type: 'oidc-confidential',
          redirectUris: ['https://app.acme.test/callback'],
          scopes: ['openid', 'profile', 'email'],
          pkceRequired: true,
        },
      );

      expect(confidential.tenantId).toBe('ten_1');
      expect(confidential.plainClientSecret).toBeDefined();
      expect(createdClients[0].tenantId).toBe('ten_1');
      expect(createdClients[0].userId).toBe('usr_owner');

      const expectedHash = crypto
        .createHash('sha256')
        .update(confidential.plainClientSecret!)
        .digest('base64url');
      expect(createdClients[0].clientSecret).toBe(expectedHash);

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

      expect(bizClients[0].clientSecret).toBeNull();
      expect(pub.plainClientSecret).toBeUndefined();
    });

    it('should reject creating a 2nd OAuth client on Free tier with 403 TIER_CLIENT_LIMIT_REACHED', async () => {
      const { service, oauthRepo } = createServiceMocks({
        tierId: 'tier_free',
      });
      (oauthRepo.countByTenant as ReturnType<typeof mock>).mockResolvedValue(1);

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

      expect(caught).toBeInstanceOf(BusinessError);
      expect((caught as BusinessError).httpStatus).toBe(403);
      expect((caught as BusinessError).code).toBe('TIER_CLIENT_LIMIT_REACHED');
      expect(oauthRepo.create).not.toHaveBeenCalled();
    });

    it('should allow creating multiple OAuth clients on paid tiers', async () => {
      const { service, oauthRepo } = createServiceMocks({
        tierId: 'tier_business',
      });
      (oauthRepo.countByTenant as ReturnType<typeof mock>).mockResolvedValue(3);

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
      expect(oauthRepo.create).toHaveBeenCalledTimes(1);
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
