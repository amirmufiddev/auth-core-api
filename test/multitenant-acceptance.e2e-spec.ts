import 'reflect-metadata';
import * as crypto from 'node:crypto';
import {
  Inject,
  Module,
  ValidationPipe,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as NestBetterAuthPkg from '@thallesp/nestjs-better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { toNodeHandler } from 'better-auth/node';
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import { CryptoService } from '@/common/crypto';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '@/common/interceptors/response-envelope.interceptor';
import { DRIZZLE } from '@/database/database.constants';
import type {
  AuthFeature,
  AuthTier,
  Tenant,
  TenantAuthFeatureConfigRow,
  TenantBillingRecord,
} from '@/database/schema';
import { buildAuthTierRows } from '@/database/seeds/auth-tiers.seed';
import {
  buildAuthFeatureRows,
  buildTierFeatureMatrix,
} from '@/database/seeds/feature-tier.seed';
import type { AppLoggerService } from '@/logger/logger.service';
import {
  AuthFeatureConfigService,
  AuthRuntimeRegistry,
  buildDefaultFeatureConfigFromEnv,
  createAuthInstance,
  MAX_ACCESS_TOKEN_TTL_SECONDS,
  resolveClampedAccessTokenTtlSeconds,
  resolveClampedJwtExpirationTime,
  SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
  SOCIAL_BRIDGE_REPOSITORY_TOKEN,
  SocialBridgeController,
  SocialBridgeService,
  type Auth,
  type FeatureConfigMap,
  type ISocialBridgeOAuthClient,
  type ISocialBridgeRepository,
} from '@/modules/auth';
import {
  BILLING_REPOSITORY_TOKEN,
  BillingService,
  type IBillingRepository,
} from '@/modules/billing';
import {
  CustomerPortalController,
  CustomerPortalService,
  PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
  PORTAL_TENANT_ORG_REPOSITORY_TOKEN,
  PORTAL_TENANT_USER_REPOSITORY_TOKEN,
  PortalTenantOrgsService,
  PortalTenantUsersService,
  TenantOwnerGuard,
  type IPortalOAuthClientRepository,
  type IPortalTenantOrgRepository,
  type IPortalTenantUserRepository,
  type PortalOAuthClientRow,
  type PortalTenantOrgRow,
  type PortalTenantUserRow,
} from '@/modules/customer-portal';
import {
  FEATURE_TIER_REPOSITORY_TOKEN,
  FeatureResolutionService,
  TenantFeatureConfigService,
  type IFeatureTierRepository,
} from '@/modules/feature-tier';
import {
  AuthConfigController,
  PlatformAuditService,
} from '@/modules/platform-console';
import { getDefaultRolePermissions } from '@/modules/rbac';
import {
  createTenantRewriteUrl,
  registerTenantResolverHook,
  TENANT_REPOSITORY_TOKEN,
  TenantContextStorage,
  TenantService,
  type ITenantRepository,
  type TenantRow,
} from '@/modules/tenant';
import {
  TENANT_CONTEXT_REPOSITORY_TOKEN,
  TenantApiOrBearerGuard,
  TenantContextController,
  TenantContextService,
  type ITenantContextRepository,
} from '@/modules/tenant-context';

const REAL_AUTH_TOKEN = Symbol('ACCEPTANCE_REAL_AUTH_TOKEN');

@Module({})
class AcceptanceBetterAuthModule implements NestModule {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(REAL_AUTH_TOKEN)
    private readonly authInstance: {
      options: { basePath?: string };
      handler: (req: Request) => Promise<Response>;
    },
  ) {}

  configure(_consumer: MiddlewareConsumer): void {
    const basePath = this.authInstance.options.basePath ?? '/api/auth';
    const handler = toNodeHandler(this.authInstance.handler);
    this.adapterHost.httpAdapter.use(
      (
        req: {
          originalUrl?: string;
          url?: string;
          baseUrl?: string;
          raw?: { url?: string };
        },
        res: unknown,
        next: () => void,
      ) => {
        const requestPath =
          req.originalUrl ?? req.url ?? req.baseUrl ?? req.raw?.url ?? '';
        if (
          requestPath !== basePath &&
          !requestPath.startsWith(`${basePath}/`)
        ) {
          next();
          return;
        }
        const nodeReq = (req.raw ?? req) as Parameters<typeof handler>[0];
        const nodeRes = ((res as { raw?: unknown })?.raw ?? res) as Parameters<
          typeof handler
        >[1];
        void handler(nodeReq, nodeRes);
      },
    );
  }

  static forRoot(options: {
    auth: {
      options: { basePath?: string };
      handler: (req: Request) => Promise<Response>;
    };
  }): DynamicModule {
    return {
      module: AcceptanceBetterAuthModule,
      providers: [{ provide: REAL_AUTH_TOKEN, useValue: options.auth }],
    };
  }
}

function getBetterAuthTestModule(auth: {
  options: { basePath?: string };
  handler: (req: Request) => Promise<Response>;
}): DynamicModule {
  const pkgAuthModule = NestBetterAuthPkg.AuthModule as unknown as {
    forRoot: (opts: {
      auth: unknown;
      disableGlobalAuthGuard: boolean;
      disableTrustedOriginsCors?: boolean;
    }) => DynamicModule;
  };
  if (typeof NestBetterAuthPkg.AuthModule === 'function') {
    return pkgAuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: true,
      disableTrustedOriginsCors: true,
    });
  }
  return AcceptanceBetterAuthModule.forRoot({ auth });
}

function createInMemoryRedis() {
  const kv = new Map<string, string>();
  const channels = new Map<string, Array<(ch: string, msg: string) => void>>();

  const client = {
    get: mock((key: string) => Promise.resolve(kv.get(key) ?? null)),
    set: mock((key: string, value: string) => {
      kv.set(key, value);
      return Promise.resolve('OK');
    }),
    getdel: mock((key: string) => {
      const val = kv.get(key) ?? null;
      kv.delete(key);
      return Promise.resolve(val);
    }),
    incr: mock((key: string) => {
      const next = Number(kv.get(key) ?? '0') + 1;
      kv.set(key, String(next));
      return Promise.resolve(next);
    }),
    del: mock((...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (kv.delete(k)) count += 1;
      }
      return Promise.resolve(count);
    }),
    publish: mock((channel: string, message: string) => {
      const listeners = channels.get(channel) ?? [];
      for (const fn of listeners) fn(channel, message);
      return Promise.resolve(listeners.length);
    }),
    duplicate: mock(() => ({
      subscribe: mock(() => Promise.resolve(1)),
      on: mock((event: string, cb: (ch: string, msg: string) => void) => {
        if (event === 'message') {
          const list = channels.get('authcore:config:invalidated') ?? [];
          list.push(cb);
          channels.set('authcore:config:invalidated', list);
        }
      }),
      unsubscribe: mock(() => Promise.resolve(0)),
      quit: mock(() => Promise.resolve('OK')),
    })),
  };

  return { kv, client };
}

function extractCookies(
  setCookieHeader: string | string[] | undefined,
): string[] {
  if (!setCookieHeader) return [];
  return Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
}

function buildCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((raw) => raw.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  return JSON.parse(
    Buffer.from(parts[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('Multi-Tenant E2E Acceptance Suite (PRD §16 & §19)', () => {
  let app: NestFastifyApplication;
  let cryptoService: CryptoService;
  let billingService: BillingService;
  let tenantService: TenantService;
  let authRuntimeRegistry: AuthRuntimeRegistry;

  const sharedMemoryDb: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    organizationRole: [],
    member: [],
    invitation: [],
    team: [],
    teamMember: [],
    twoFactor: [],
    passkey: [],
    apikey: [],
    deviceCode: [],
    oauthClient: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
    oauthResource: [],
    jwks: [],
  };

  const tenantsStore = new Map<string, Tenant>();
  const billingStore = new Map<string, TenantBillingRecord>();
  const tenantFeatureConfigsStore = new Map<
    string,
    TenantAuthFeatureConfigRow
  >();

  const tiersStore: AuthTier[] = buildAuthTierRows().map((t) => ({
    ...t,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  const featuresStore: AuthFeature[] = buildAuthFeatureRows().map((f) => ({
    id: `feat_${f.code}`,
    code: f.code,
    name: f.name,
    description: f.description,
    category: f.category,
    packageName: f.packageName,
    status: f.status,
    dependencies: f.dependencies,
    availableSetting: f.availableSetting,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  const tierMatrix = buildTierFeatureMatrix();
  const tierFeaturesMap = new Map<string, Set<string>>();
  for (const tier of tiersStore) {
    const codes = tierMatrix[tier.code as keyof typeof tierMatrix] ?? [];
    tierFeaturesMap.set(tier.id, new Set(codes.map((code) => `feat_${code}`)));
  }

  const redis = createInMemoryRedis();

  const mockConfigService = {
    get: mock((key: string) => {
      if (key === 'app') {
        return {
          appName: 'AuthCore',
          appVersion: '1.0.0',
          baseUrl: 'http://localhost:2001',
          corsOrigins: ['http://localhost:3000', 'http://localhost:2001'],
          fallbackLanguage: 'id',
        };
      }
      if (key === 'auth') {
        return {
          url: 'http://localhost:2001',
          secret: 'test-secret-min-32-chars-here-for-testing-only',
          path: '/api/auth',
          google: { clientId: '', clientSecret: '' },
          useSecureCookies: false,
          errorURL: '/error',
          session: {
            expiresIn: 3600,
            updateAge: 300,
            cookieCache: { enabled: false, maxAge: 300 },
          },
          membershipLimit: 10,
          organizationLimit: 5,
          invitationExpiresIn: 86400,
          inviteURL: 'http://localhost:3000/invite',
        };
      }
      if (key === 'TENANT_BASE_DOMAIN') return 'authcore.local';
      if (key === 'BETTER_AUTH_URL') return 'http://localhost:2001';
      if (key === 'BETTER_AUTH_SECRET') {
        return 'test-secret-min-32-chars-here-for-testing-only';
      }
      if (key === 'SOCIAL_CALLBACK_BASE_URL') return 'http://localhost:2001';
      if (key === 'AUTH_CONFIG_ENCRYPTION_KEY') {
        return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  const mockLogger = {
    log: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    debug: mock(() => undefined),
  } as unknown as AppLoggerService;

  // State shared across scenarios
  let amirCookie = '';
  let bimaCookie = '';
  let citraCookie = '';
  let amirUserId = '';
  let bimaUserId = '';

  let posAmirTenant: Tenant;
  let sekolahBimaTenant: Tenant;
  let _posCitraTenant: Tenant;

  let amirOAuthClientId = '';
  let amirOAuthClientSecret = '';
  let bimaOAuthClientId = '';

  let asepAmirCookie = '';
  let asepAmirUserId = '';
  let asepBimaUserId = '';
  let warungAsepOrgId = '';
  let sekolahBimaOrgId = '';
  let budiInvitationId = '';
  let budiAmirCookie = '';
  let budiAmirUserId = '';

  let socialBridgeProfileEmail = 'social-user@pos.id';
  let socialBridgeEmailVerified = true;

  beforeAll(async () => {
    process.env.AUTH_CONFIG_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const tenantRepo: ITenantRepository = {
      findById: (id) => Promise.resolve(tenantsStore.get(id) ?? null),
      findBySlug: (slug) =>
        Promise.resolve(
          Array.from(tenantsStore.values()).find((t) => t.slug === slug) ??
            null,
        ),
      listPaginated: (query) => {
        const all = Array.from(tenantsStore.values()).filter((t) => {
          if (query.ownerUserId && t.ownerUserId !== query.ownerUserId) {
            return false;
          }
          if (query.status && t.status !== query.status) {
            return false;
          }
          if (query.tierId && t.tierId !== query.tierId) {
            return false;
          }
          if (query.search) {
            const q = query.search.toLowerCase();
            return (
              t.name.toLowerCase().includes(q) ||
              t.slug.toLowerCase().includes(q)
            );
          }
          return true;
        });
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 20;
        return Promise.resolve({
          items: all.slice(page * pageSize, (page + 1) * pageSize),
          total: all.length,
        });
      },
      create: (input) => {
        const now = new Date();
        const tenant: Tenant = {
          id: input.id,
          slug: input.slug,
          name: input.name,
          ownerUserId: input.ownerUserId,
          tierId: input.tierId ?? 'tier_free',
          status: input.status ?? 'active',
          billingStatus: input.billingStatus ?? 'active',
          configVersion: input.configVersion ?? 1,
          createdAt: now,
          updatedAt: now,
        };
        tenantsStore.set(tenant.id, tenant);
        return Promise.resolve(tenant);
      },
      update: (id, patch, options) => {
        const existing = tenantsStore.get(id);
        if (!existing) {
          throw new Error(`Tenant ${id} not found`);
        }
        const updated: TenantRow = {
          ...existing,
          ...patch,
          configVersion: options?.bumpConfigVersion
            ? existing.configVersion + 1
            : (patch.configVersion ?? existing.configVersion),
          updatedAt: new Date(),
        };
        tenantsStore.set(id, updated);
        return Promise.resolve(updated);
      },
      incrementConfigVersion: (id) => {
        const existing = tenantsStore.get(id);
        if (!existing) {
          throw new Error(`Tenant ${id} not found`);
        }
        const nextVersion = existing.configVersion + 1;
        tenantsStore.set(id, {
          ...existing,
          configVersion: nextVersion,
          updatedAt: new Date(),
        });
        return Promise.resolve(nextVersion);
      },
      tierExists: (tierId) =>
        Promise.resolve(tiersStore.some((t) => t.id === tierId)),
    };

    const billingRepo: IBillingRepository = {
      listPaginated: (query) => {
        const all = Array.from(billingStore.values()).filter((b) => {
          if (query.tenantId && b.tenantId !== query.tenantId) return false;
          if (query.tierId && b.tierId !== query.tierId) return false;
          if (query.status && b.status !== query.status) return false;
          return true;
        });
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 10;
        return Promise.resolve({
          items: all.slice(page * pageSize, (page + 1) * pageSize),
          total: all.length,
        });
      },
      findById: (id) => Promise.resolve(billingStore.get(id) ?? null),
      tenantExists: (tenantId) => Promise.resolve(tenantsStore.has(tenantId)),
      tierExists: (tierId) =>
        Promise.resolve(tiersStore.some((t) => t.id === tierId)),
      recordAndSyncTenantStatus: (input) => {
        const record: TenantBillingRecord = {
          id: `bill_${crypto.randomUUID().slice(0, 8)}`,
          tenantId: input.record.tenantId,
          tierId: input.record.tierId,
          status: input.record.status,
          amount: input.record.amount,
          currency: input.record.currency ?? 'IDR',
          periodStart: input.record.periodStart,
          periodEnd: input.record.periodEnd,
          note: input.record.note ?? null,
          recordedBy: input.record.recordedBy ?? null,
          createdAt: new Date(),
        };
        billingStore.set(record.id, record);
        const existingTenant = tenantsStore.get(input.record.tenantId);
        if (existingTenant && input.nextTenantBillingStatus) {
          tenantsStore.set(existingTenant.id, {
            ...existingTenant,
            billingStatus: input.nextTenantBillingStatus,
            updatedAt: new Date(),
          });
        }
        return Promise.resolve(record);
      },
    };

    const portalRepo: IPortalOAuthClientRepository = {
      listByTenantPaginated: (query) => {
        const rows = (
          sharedMemoryDb.oauthClient as Array<Record<string, unknown>>
        ).filter((c) => c.tenantId === query.tenantId);
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 20;
        return Promise.resolve({
          items: rows
            .slice(page * pageSize, (page + 1) * pageSize)
            .map((c) => c as unknown as PortalOAuthClientRow),
          total: rows.length,
        });
      },
      createWithQuotaCheck: (input, maxClients) => {
        const existingCount = (
          sharedMemoryDb.oauthClient as Array<Record<string, unknown>>
        ).filter((c) => c.tenantId === input.tenantId).length;
        if (maxClients !== undefined && existingCount >= maxClients) {
          throw new Error('TIER_CLIENT_LIMIT_REACHED');
        }
        const now = new Date();
        const row = {
          id: input.id,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          name: input.name,
          redirectUris: input.redirectUris,
          scopes: input.scopes,
          grantTypes: ['authorization_code', 'refresh_token'],
          responseTypes: ['code'],
          type: input.applicationType,
          public: input.tokenEndpointAuthMethod === 'none',
          requirePKCE: input.requirePKCE,
          tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
          applicationType: input.applicationType,
          metadata: input.metadata,
          disabled: false,
          skipConsent: false,
          tenantId: input.tenantId,
          userId: input.userId,
          createdAt: now,
          updatedAt: now,
        };
        (sharedMemoryDb.oauthClient as Array<Record<string, unknown>>).push(
          row,
        );
        return Promise.resolve(row as unknown as PortalOAuthClientRow);
      },
      deleteByTenantAndId: (tenantId, id) => {
        const list = sharedMemoryDb.oauthClient as Array<
          Record<string, unknown>
        >;
        const idx = list.findIndex(
          (c) => c.id === id && c.tenantId === tenantId,
        );
        if (idx === -1) return Promise.resolve(false);
        list.splice(idx, 1);
        return Promise.resolve(true);
      },
    };

    const portalUsersRepo: IPortalTenantUserRepository = {
      listByTenantPaginated: (query) => {
        const rows = (
          sharedMemoryDb.user as Array<Record<string, unknown>>
        ).filter((u) => u.tenantId === query.tenantId);
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 20;
        return Promise.resolve({
          items: rows
            .slice(page * pageSize, (page + 1) * pageSize)
            .map((u) => ({
              id: String(u.id),
              name: String(u.name),
              email: String(u.email),
              emailVerified: Boolean(u.emailVerified),
              image: (u.image as string) ?? null,
              role: (u.role as string) ?? null,
              banned: Boolean(u.banned),
              banReason: (u.banReason as string) ?? null,
              banExpires: (u.banExpires as Date) ?? null,
              username: (u.username as string) ?? null,
              displayUsername: (u.displayUsername as string) ?? null,
              phoneNumber: (u.phoneNumber as string) ?? null,
              phoneNumberVerified: Boolean(u.phoneNumberVerified),
              twoFactorEnabled: Boolean(u.twoFactorEnabled),
              isAnonymous: Boolean(u.isAnonymous),
              lastLoginMethod: (u.lastLoginMethod as string) ?? null,
              tenantId: String(u.tenantId),
              createdAt: (u.createdAt as Date) ?? new Date(),
              updatedAt: (u.updatedAt as Date) ?? new Date(),
            })) as PortalTenantUserRow[],
          total: rows.length,
        });
      },
    };

    const portalOrgsRepo: IPortalTenantOrgRepository = {
      listByTenantPaginated: (query) => {
        const orgs = (
          sharedMemoryDb.organization as Array<Record<string, unknown>>
        ).filter((o) => o.tenantId === query.tenantId);
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 20;
        return Promise.resolve({
          items: orgs
            .slice(page * pageSize, (page + 1) * pageSize)
            .map((o) => ({
              id: String(o.id),
              name: String(o.name),
              slug: (o.slug as string) ?? null,
              logo: (o.logo as string) ?? null,
              metadata: (o.metadata as string) ?? null,
              tenantId: String(o.tenantId),
              createdAt: (o.createdAt as Date) ?? new Date(),
            })) as PortalTenantOrgRow[],
          total: orgs.length,
        });
      },
    };

    const featureTierRepo: IFeatureTierRepository = {
      listFeatures: () => Promise.resolve(featuresStore),
      findFeatureByIdOrCode: (idOrCode) =>
        Promise.resolve(
          featuresStore.find((f) => f.id === idOrCode || f.code === idOrCode) ??
            null,
        ),
      updateFeatureStatus: (featureId, status) => {
        const feat = featuresStore.find((f) => f.id === featureId);
        if (!feat) return Promise.resolve(null);
        feat.status = status;
        return Promise.resolve(feat);
      },
      listTiersWithFeatures: () =>
        Promise.resolve(
          tiersStore.map((tier) => {
            const featureIds = Array.from(tierFeaturesMap.get(tier.id) ?? []);
            const featureCodes = featureIds
              .map((id) => featuresStore.find((f) => f.id === id)?.code ?? '')
              .filter(Boolean);
            return { ...tier, featureIds, featureCodes };
          }),
        ),
      findTierById: (tierId) =>
        Promise.resolve(tiersStore.find((t) => t.id === tierId) ?? null),
      getTierFeatureIds: (tierId) =>
        Promise.resolve(Array.from(tierFeaturesMap.get(tierId) ?? [])),
      replaceTierFeatures: (tierId, featureIds) => {
        tierFeaturesMap.set(tierId, new Set(featureIds));
        return Promise.resolve();
      },
      listPlatformFeatureConfigs: () => Promise.resolve([]),
      listTenantFeatureConfigs: (tenantId) =>
        Promise.resolve(
          Array.from(tenantFeatureConfigsStore.values()).filter(
            (c) => c.tenantId === tenantId,
          ),
        ),
      findTenantFeatureConfig: (tenantId, featureId) =>
        Promise.resolve(
          tenantFeatureConfigsStore.get(`${tenantId}:${featureId}`) ?? null,
        ),
      upsertTenantFeatureConfig: (input) => {
        const key = `${input.tenantId}:${input.featureId}`;
        const now = new Date();
        const row: TenantAuthFeatureConfigRow = {
          tenantId: input.tenantId,
          featureId: input.featureId,
          enabled: input.enabled,
          settings: input.settings,
          secrets: input.secrets,
          updatedBy: input.updatedBy ?? null,
          updatedAt: now,
        };
        tenantFeatureConfigsStore.set(key, row);
        return Promise.resolve(row);
      },
      bumpTenantConfigVersion: (tenantId) => {
        const existing = tenantsStore.get(tenantId);
        if (!existing) return Promise.resolve(1);
        const nextVersion = existing.configVersion + 1;
        tenantsStore.set(tenantId, {
          ...existing,
          configVersion: nextVersion,
          updatedAt: new Date(),
        });
        return Promise.resolve(nextVersion);
      },
    };

    const tenantContextRepo: ITenantContextRepository = {
      findTenantStatus: (tenantId) =>
        Promise.resolve(tenantsStore.get(tenantId)?.status ?? null),
      findUserTenantId: (userId) => {
        const u = (sharedMemoryDb.user as Array<Record<string, unknown>>).find(
          (row) => row.id === userId,
        );
        if (!u) return Promise.resolve(null);
        return Promise.resolve({ tenantId: (u.tenantId as string) ?? null });
      },
      findApiKeyByHashedKey: (hashedKey) => {
        const k = (
          sharedMemoryDb.apikey as Array<Record<string, unknown>>
        ).find((row) => row.key === hashedKey);
        if (!k) return Promise.resolve(null);
        return Promise.resolve({
          id: String(k.id),
          referenceId: String(k.referenceId),
          tenantId: (k.tenantId as string) ?? null,
          key: String(k.key),
          enabled: k.enabled !== false,
          expiresAt: (k.expiresAt as Date) ?? null,
        });
      },
      findOrganizationById: (organizationId) => {
        const o = (
          sharedMemoryDb.organization as Array<Record<string, unknown>>
        ).find((row) => row.id === organizationId);
        if (!o) return Promise.resolve(null);
        return Promise.resolve({
          id: String(o.id),
          name: String(o.name),
          slug: (o.slug as string) ?? null,
          logo: (o.logo as string) ?? null,
          tenantId: String(o.tenantId),
          createdAt: (o.createdAt as Date) ?? new Date(),
        });
      },
      findMemberInOrganization: (organizationId, userId) => {
        const m = (
          sharedMemoryDb.member as Array<Record<string, unknown>>
        ).find(
          (row) =>
            row.organizationId === organizationId && row.userId === userId,
        );
        if (!m) return Promise.resolve(null);
        return Promise.resolve({
          role: String(m.role),
          tenantId: (m.tenantId as string) ?? null,
        });
      },
      findOrganizationRolePermissions: (organizationId, role) => {
        const r = (
          sharedMemoryDb.organizationRole as Array<Record<string, unknown>>
        ).find(
          (row) => row.organizationId === organizationId && row.role === role,
        );
        return Promise.resolve((r?.permission as string) ?? null);
      },
      listOrganizationsForTenant: (params) => {
        const members = sharedMemoryDb.member as Array<Record<string, unknown>>;
        const orgs = (
          sharedMemoryDb.organization as Array<Record<string, unknown>>
        ).filter((o) => {
          if (o.tenantId !== params.tenantId) return false;
          if (params.userId) {
            return members.some(
              (m) => m.organizationId === o.id && m.userId === params.userId,
            );
          }
          return true;
        });
        return Promise.resolve({
          items: orgs
            .slice(params.offset, params.offset + params.limit)
            .map((o) => ({
              id: String(o.id),
              name: String(o.name),
              slug: (o.slug as string) ?? null,
              logo: (o.logo as string) ?? null,
              tenantId: String(o.tenantId),
              createdAt: (o.createdAt as Date) ?? new Date(),
            })),
          total: orgs.length,
        });
      },
      listOrganizationMembers: (params) => {
        const users = sharedMemoryDb.user as Array<Record<string, unknown>>;
        const members = (
          sharedMemoryDb.member as Array<Record<string, unknown>>
        ).filter((m) => m.organizationId === params.organizationId);
        return Promise.resolve({
          items: members
            .slice(params.offset, params.offset + params.limit)
            .map((m) => {
              const u = users.find((usr) => usr.id === m.userId);
              return {
                id: String(m.id),
                userId: String(m.userId),
                role: String(m.role),
                userName: (u?.name as string) ?? null,
                userEmail: (u?.email as string) ?? null,
                createdAt: (m.createdAt as Date) ?? new Date(),
              };
            }),
          total: members.length,
        });
      },
    };

    const socialBridgeRepo: ISocialBridgeRepository = {
      findTenantCredentials: async (tenantId, provider) => {
        if (provider !== 'google') return null;
        const tenant = tenantsStore.get(tenantId);
        if (!tenant) return null;
        const resolved = await featureResolutionService.resolveForTenant(
          tenantId,
          tenant.tierId,
        );
        if (!resolved.configMap.socialGoogle?.enabled) return null;
        const clientId = String(
          resolved.configMap.socialGoogle.settings?.clientId ?? '',
        );
        const clientSecret =
          resolved.decryptedSecrets.socialGoogle?.clientSecret ?? '';
        if (!clientId || !clientSecret) return null;
        return { clientId, clientSecret };
      },
      findAccountByProvider: (tenantId, provider, providerAccountId) => {
        const acc = (
          sharedMemoryDb.account as Array<Record<string, unknown>>
        ).find(
          (a) =>
            a.tenantId === tenantId &&
            a.providerId === provider &&
            a.accountId === providerAccountId,
        );
        return Promise.resolve(
          acc ? { id: String(acc.id), userId: String(acc.userId) } : null,
        );
      },
      findUserByTenantEmail: (tenantId, email) => {
        const u = (sharedMemoryDb.user as Array<Record<string, unknown>>).find(
          (row) => row.tenantId === tenantId && row.email === email,
        );
        return Promise.resolve(
          u
            ? {
                id: String(u.id),
                email: String(u.email),
                emailVerified: Boolean(u.emailVerified),
              }
            : null,
        );
      },
      createUserWithAccount: (input) => {
        const now = new Date();
        const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
        (sharedMemoryDb.user as Array<Record<string, unknown>>).push({
          id: userId,
          name: input.name,
          email: input.email,
          emailVerified: input.emailVerified,
          role: 'user',
          tenantId: input.tenantId,
          banned: false,
          createdAt: now,
          updatedAt: now,
        });
        (sharedMemoryDb.account as Array<Record<string, unknown>>).push({
          id: `acc_${crypto.randomUUID().slice(0, 8)}`,
          userId,
          accountId: input.providerAccountId,
          providerId: input.provider,
          tenantId: input.tenantId,
          createdAt: now,
          updatedAt: now,
        });
        return Promise.resolve({ userId, email: input.email });
      },
      linkAccountToUser: (input) => {
        const now = new Date();
        (sharedMemoryDb.account as Array<Record<string, unknown>>).push({
          id: `acc_${crypto.randomUUID().slice(0, 8)}`,
          userId: input.userId,
          accountId: input.providerAccountId,
          providerId: input.provider,
          tenantId: input.tenantId,
          createdAt: now,
          updatedAt: now,
        });
        return Promise.resolve();
      },
      createSession: (input) => {
        const now = new Date();
        const id = `ses_${crypto.randomUUID().slice(0, 8)}`;
        (sharedMemoryDb.session as Array<Record<string, unknown>>).push({
          id,
          userId: input.userId,
          token: input.token,
          tenantId: input.tenantId,
          expiresAt: input.expiresAt,
          createdAt: now,
          updatedAt: now,
        });
        return Promise.resolve({ id, token: input.token });
      },
    };

    const socialBridgeOAuthClient: ISocialBridgeOAuthClient = {
      exchangeCodeForProfile: mock(() =>
        Promise.resolve({
          providerAccountId: `google-sub-${socialBridgeProfileEmail}`,
          email: socialBridgeProfileEmail,
          name: 'Social User',
          emailVerified: socialBridgeEmailVerified,
        }),
      ),
    };

    const buildBaseFeatureConfig = (): FeatureConfigMap => {
      const fc = buildDefaultFeatureConfigFromEnv();
      fc.emailVerification.enabled = false;
      fc.rateLimit.enabled = false;
      fc.haveIBeenPwned.enabled = false;
      fc.organization.enabled = true;
      fc.oauthProvider.enabled = true;
      fc.jwt.enabled = true;
      fc.twoFactor.enabled = true;
      fc.apiKey.enabled = true;
      fc.deviceAuthorization.enabled = true;
      fc.passkey.enabled = true;
      fc.auditLogs.enabled = true;
      fc.socialGoogle.enabled = false;
      return fc;
    };

    tenantService = new TenantService(
      tenantRepo,
      redis.client as unknown as ConstructorParameters<typeof TenantService>[1],
    );
    cryptoService = new CryptoService(mockConfigService);
    const featureResolutionService = new FeatureResolutionService(
      featureTierRepo,
      cryptoService,
      tenantService,
      redis.client as unknown as ConstructorParameters<
        typeof FeatureResolutionService
      >[3],
    );

    authRuntimeRegistry = new AuthRuntimeRegistry(
      redis.client as unknown as ConstructorParameters<
        typeof AuthRuntimeRegistry
      >[0],
      mockConfigService,
    );

    const buildPlatformAuth = (): Auth =>
      createAuthInstance({
        configService: mockConfigService,
        database: memoryAdapter(sharedMemoryDb),
        tenantContext: null,
        featureConfig: buildBaseFeatureConfig(),
      });

    const buildTenantAuth = async (
      ctx: NonNullable<ReturnType<typeof TenantContextStorage.get>>,
    ): Promise<Auth> => {
      const tenant = ctx.tenantId ? tenantsStore.get(ctx.tenantId) : undefined;
      const tierId = ctx.tierId ?? tenant?.tierId ?? 'tier_free';
      const resolved = await featureResolutionService.resolveForTenant(
        ctx.tenantId!,
        tierId,
      );
      const fc = {
        ...buildBaseFeatureConfig(),
        ...resolved.configMap,
      };
      // Keep core auth plugins active for acceptance tests
      fc.emailVerification.enabled = false;
      fc.rateLimit.enabled = false;
      fc.haveIBeenPwned.enabled = false;
      fc.organization.enabled = true;
      fc.oauthProvider.enabled = true;
      fc.jwt.enabled = true;
      fc.apiKey.enabled = true;

      return createAuthInstance({
        configService: mockConfigService,
        database: memoryAdapter(sharedMemoryDb),
        tenantContext: ctx,
        tenantStatus: tenant?.status ?? 'active',
        featureConfig: fc,
        decryptedSecrets: resolved.decryptedSecrets,
        resolveTenantClaims: (userId, activeOrganizationId) => {
          const tenantId = ctx.tenantId;
          if (!tenantId || !userId) {
            return Promise.resolve({
              tenant_id: tenantId,
              active_organization_id: null,
              org_role: null,
              org_permissions: [],
            });
          }
          const members = sharedMemoryDb.member as Array<
            Record<string, unknown>
          >;
          const orgs = sharedMemoryDb.organization as Array<
            Record<string, unknown>
          >;
          const targetOrgId =
            activeOrganizationId ??
            (members.find((m) => m.userId === userId && m.tenantId === tenantId)
              ?.organizationId as string | undefined) ??
            null;
          const org = targetOrgId
            ? orgs.find((o) => o.id === targetOrgId && o.tenantId === tenantId)
            : undefined;
          const membership = org
            ? members.find(
                (m) => m.organizationId === org.id && m.userId === userId,
              )
            : undefined;
          if (!org || !membership) {
            return Promise.resolve({
              tenant_id: tenantId,
              active_organization_id: null,
              org_role: null,
              org_permissions: [],
            });
          }
          const role = String(membership.role);
          const roleMatrix = getDefaultRolePermissions()[role] ?? {};
          const permissions = Object.entries(roleMatrix).flatMap(
            ([resource, actions]) =>
              actions.map((action) => `${resource}:${action}`),
          );
          return Promise.resolve({
            tenant_id: tenantId,
            active_organization_id: String(org.id),
            org_role: role,
            org_permissions: permissions,
          });
        },
      });
    };

    const platformAuthConfigDb = {
      select: () => ({
        from: () => ({
          innerJoin: () =>
            Promise.resolve([
              {
                featureId: 'feat_socialGoogle',
                featureCode: 'socialGoogle',
                enabled: false,
                settings: {},
                secrets: {},
                availableSetting: [],
              },
            ]),
        }),
      }),
    };
    const platformFeatureConfigService = new AuthFeatureConfigService(
      platformAuthConfigDb as never,
      mockLogger,
      cryptoService,
    );
    await platformFeatureConfigService.loadFromDatabase();

    const platformAuth = buildPlatformAuth();
    authRuntimeRegistry.initialize({
      platformInstance: platformAuth,
      buildPlatformAuth,
      buildTenantAuth,
    });

    const authProxy = authRuntimeRegistry.createContextAwareProxy();

    const fastifyAdapter = new FastifyAdapter({
      rewriteUrl: createTenantRewriteUrl() as unknown as (
        req: unknown,
      ) => string,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [getBetterAuthTestModule(authProxy)],
      controllers: [
        CustomerPortalController,
        TenantContextController,
        SocialBridgeController,
        AuthConfigController,
      ],
      providers: [
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DRIZZLE, useValue: {} },
        { provide: BETTER_AUTH_REDIS_CLIENT, useValue: redis.client },
        { provide: TENANT_REPOSITORY_TOKEN, useValue: tenantRepo },
        { provide: BILLING_REPOSITORY_TOKEN, useValue: billingRepo },
        { provide: PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN, useValue: portalRepo },
        {
          provide: PORTAL_TENANT_USER_REPOSITORY_TOKEN,
          useValue: portalUsersRepo,
        },
        {
          provide: PORTAL_TENANT_ORG_REPOSITORY_TOKEN,
          useValue: portalOrgsRepo,
        },
        { provide: FEATURE_TIER_REPOSITORY_TOKEN, useValue: featureTierRepo },
        {
          provide: TENANT_CONTEXT_REPOSITORY_TOKEN,
          useValue: tenantContextRepo,
        },
        {
          provide: SOCIAL_BRIDGE_REPOSITORY_TOKEN,
          useValue: socialBridgeRepo,
        },
        {
          provide: SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
          useValue: socialBridgeOAuthClient,
        },
        { provide: CryptoService, useValue: cryptoService },
        { provide: TenantService, useValue: tenantService },
        {
          provide: AuthFeatureConfigService,
          useValue: platformFeatureConfigService,
        },
        {
          provide: PlatformAuditService,
          useValue: { recordAudit: mock(() => Promise.resolve()) },
        },
        BillingService,
        CustomerPortalService,
        PortalTenantUsersService,
        PortalTenantOrgsService,
        {
          provide: FeatureResolutionService,
          useValue: featureResolutionService,
        },
        TenantFeatureConfigService,
        TenantContextService,
        SocialBridgeService,
        TenantOwnerGuard,
        TenantApiOrBearerGuard,
        { provide: AuthRuntimeRegistry, useValue: authRuntimeRegistry },
      ],
    }).compile();

    app =
      moduleRef.createNestApplication<NestFastifyApplication>(fastifyAdapter);
    app.useGlobalFilters(new AllExceptionsFilter(mockLogger));
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    registerTenantResolverHook(
      app,
      (slug) => tenantService.resolveSlugSummary(slug),
      ['localhost', '127.0.0.1', 'auth.authcore.local'],
      { tenantBaseDomain: 'authcore.local' },
    );

    const fastifyInstance = app.getHttpAdapter().getInstance();

    // Populate req.session for NestJS controllers from Better Auth session
    fastifyInstance.addHook('preHandler', async (request) => {
      const reqWithSession = request as unknown as {
        session?: unknown;
        headers: Record<string, string | string[] | undefined>;
      };
      if (reqWithSession.session) return;
      const ctx = TenantContextStorage.get();
      const auth = await authRuntimeRegistry.getForContext(ctx);
      const headers = new Headers();
      for (const [k, v] of Object.entries(reqWithSession.headers)) {
        if (typeof v === 'string') headers.set(k, v);
      }
      const session = await auth.api.getSession({ headers });
      if (session) {
        reqWithSession.session = session;
      }
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    billingService = moduleRef.get(BillingService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('should register Amir, Bima, Citra as platform accounts (tenantId === null), create tenants with immutable slugs & tenant-bound OAuth clients', async () => {
    const registerPlatformUser = async (name: string, email: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: { name, email, password: 'Password123!' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        user: { id: string; email: string; tenantId?: string | null };
      };
      expect(body.user.tenantId ?? null).toBeNull();
      const cookies = extractCookies(res.headers['set-cookie']);
      return {
        userId: body.user.id,
        cookie: buildCookieHeader(cookies),
      };
    };

    const amir = await registerPlatformUser('Amir', 'amir@platform.id');
    const bima = await registerPlatformUser('Bima', 'bima@platform.id');
    const citra = await registerPlatformUser('Citra', 'citra@platform.id');

    amirUserId = amir.userId;
    amirCookie = amir.cookie;
    bimaUserId = bima.userId;
    bimaCookie = bima.cookie;
    citraCookie = citra.cookie;

    // Reserved slug rejected
    const reservedRes = await app.inject({
      method: 'POST',
      url: '/api/portal/tenants',
      headers: { cookie: amirCookie },
      payload: { name: 'Admin Tenant', slug: 'admin' },
    });
    expect(reservedRes.statusCode).toBe(400);

    // Create 3 tenants
    const createTenant = async (
      cookie: string,
      name: string,
      slug: string,
    ): Promise<Tenant> => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/portal/tenants',
        headers: { cookie },
        payload: { name, slug },
      });
      expect(res.statusCode).toBe(201);
      const body = (res.json() as { success: true; data: Tenant }).data;
      expect(body.slug).toBe(slug);
      return body;
    };

    posAmirTenant = await createTenant(amirCookie, 'POS Amir', 'pos-amir');
    sekolahBimaTenant = await createTenant(
      bimaCookie,
      'Sekolah Bima',
      'sekolah-bima',
    );
    _posCitraTenant = await createTenant(citraCookie, 'POS Citra', 'pos-citra');

    // Slug is immutable on PATCH (sending slug returns 400 TENANT_SLUG_IMMUTABLE)
    const immutableRes = await app.inject({
      method: 'PATCH',
      url: `/api/portal/tenants/${posAmirTenant.id}`,
      headers: { cookie: amirCookie },
      payload: { name: 'POS Amir Updated', slug: 'hacked-slug' },
    });
    expect(immutableRes.statusCode).toBe(400);

    // Updating name without slug succeeds and keeps slug immutable
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/portal/tenants/${posAmirTenant.id}`,
      headers: { cookie: amirCookie },
      payload: { name: 'POS Amir Updated' },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchedTenant = (patchRes.json() as { success: true; data: Tenant })
      .data;
    expect(patchedTenant.slug).toBe('pos-amir');
    expect(patchedTenant.name).toBe('POS Amir Updated');

    // Cross-owner portal access rejected with 403
    const crossOwnerRes = await app.inject({
      method: 'GET',
      url: `/api/portal/tenants/${posAmirTenant.id}`,
      headers: { cookie: bimaCookie },
    });
    expect(crossOwnerRes.statusCode).toBe(403);

    // Create OAuth clients bound to tenant_id; plainClientSecret returned once
    const amirClientRes = await app.inject({
      method: 'POST',
      url: `/api/portal/tenants/${posAmirTenant.id}/oauth-clients`,
      headers: { cookie: amirCookie },
      payload: {
        name: 'POS Amir App',
        type: 'oidc-confidential',
        redirectUris: ['https://pos-app.example.com/callback'],
        scopes: ['openid', 'profile', 'email'],
        pkceRequired: true,
      },
    });
    expect(amirClientRes.statusCode).toBe(201);
    const amirClientBody = (
      amirClientRes.json() as {
        success: true;
        data: {
          clientId: string;
          plainClientSecret?: string;
          tenantId: string;
        };
      }
    ).data;
    expect(amirClientBody.tenantId).toBe(posAmirTenant.id);
    expect(amirClientBody.plainClientSecret).toBeTruthy();
    amirOAuthClientId = amirClientBody.clientId;
    amirOAuthClientSecret = amirClientBody.plainClientSecret!;

    // GET list does not leak plainClientSecret
    const listClientsRes = await app.inject({
      method: 'GET',
      url: `/api/portal/tenants/${posAmirTenant.id}/oauth-clients`,
      headers: { cookie: amirCookie },
    });
    expect(listClientsRes.statusCode).toBe(200);
    const listClientsBody = (
      listClientsRes.json() as {
        success: true;
        data: { items: Array<Record<string, unknown>> };
      }
    ).data;
    expect(listClientsBody.items).toHaveLength(1);
    expect(listClientsBody.items[0]?.plainClientSecret).toBeUndefined();

    const bimaClientRes = await app.inject({
      method: 'POST',
      url: `/api/portal/tenants/${sekolahBimaTenant.id}/oauth-clients`,
      headers: { cookie: bimaCookie },
      payload: {
        name: 'Sekolah Bima App',
        type: 'oidc-confidential',
        redirectUris: ['http://localhost:4001/callback'],
        scopes: ['openid', 'profile'],
        pkceRequired: true,
      },
    });
    expect(bimaClientRes.statusCode).toBe(201);
    bimaOAuthClientId = (
      bimaClientRes.json() as {
        success: true;
        data: { clientId: string };
      }
    ).data.clientId;
  });

  it('should register Asep on pos-amir, create Warung Asep (owner) without Amir as member, and register same email on sekolah-bima as distinct user', async () => {
    const asepAmirRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/sign-up/email',
      payload: {
        name: 'Asep Warung',
        email: 'asep@warung.id',
        password: 'Password123!',
      },
    });
    expect(asepAmirRes.statusCode).toBe(200);
    const asepAmirBody = asepAmirRes.json() as {
      user: { id: string; tenantId: string };
    };
    asepAmirUserId = asepAmirBody.user.id;
    expect(asepAmirBody.user.tenantId).toBe(posAmirTenant.id);
    asepAmirCookie = buildCookieHeader(
      extractCookies(asepAmirRes.headers['set-cookie']),
    );

    // Asep creates organization Warung Asep
    const createOrgRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/organization/create',
      headers: { cookie: asepAmirCookie },
      payload: { name: 'Warung Asep', slug: 'warung-asep' },
    });
    expect(createOrgRes.statusCode).toBe(200);
    const orgBody = createOrgRes.json() as {
      id: string;
      tenantId: string;
      metadata?: Record<string, unknown> | null;
    };
    warungAsepOrgId = orgBody.id;
    expect(orgBody.tenantId).toBe(posAmirTenant.id);
    // PRD §19: organization.metadata must NOT store plan (Free/Pro/Enterprise)
    expect(orgBody.metadata?.plan).toBeUndefined();

    // Verify member table: Asep is owner, Amir is NOT in member table
    const members = (
      sharedMemoryDb.member as Array<Record<string, unknown>>
    ).filter((m) => m.organizationId === warungAsepOrgId);
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(asepAmirUserId);
    expect(members[0]?.role).toBe('owner');
    expect(members.some((m) => m.userId === amirUserId)).toBe(false);

    // Same email registers on sekolah-bima as a distinct user
    const asepBimaRes = await app.inject({
      method: 'POST',
      url: '/t/sekolah-bima/api/auth/sign-up/email',
      payload: {
        name: 'Asep Sekolah',
        email: 'asep@warung.id',
        password: 'Password123!',
      },
    });
    expect(asepBimaRes.statusCode).toBe(200);
    const asepBimaBody = asepBimaRes.json() as {
      user: { id: string; tenantId: string };
    };
    asepBimaUserId = asepBimaBody.user.id;
    expect(asepBimaBody.user.tenantId).toBe(sekolahBimaTenant.id);
    expect(asepBimaUserId).not.toBe(asepAmirUserId);

    // Create an org in sekolah-bima for cross-tenant tests
    const asepBimaCookie = buildCookieHeader(
      extractCookies(asepBimaRes.headers['set-cookie']),
    );
    const bimaOrgRes = await app.inject({
      method: 'POST',
      url: '/t/sekolah-bima/api/auth/organization/create',
      headers: { cookie: asepBimaCookie },
      payload: { name: 'Kelas Bima', slug: 'kelas-bima' },
    });
    expect(bimaOrgRes.statusCode).toBe(200);
    sekolahBimaOrgId = (bimaOrgRes.json() as { id: string }).id;
  });

  it('should invite budi@warung.id and keep Budi out of member table until accepting invitation on pos-amir', async () => {
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/organization/invite-member',
      headers: { cookie: asepAmirCookie },
      payload: {
        email: 'budi@warung.id',
        role: 'member',
        organizationId: warungAsepOrgId,
      },
    });
    expect(inviteRes.statusCode).toBe(200);
    budiInvitationId = (inviteRes.json() as { id: string }).id;
    expect(budiInvitationId).toBeTruthy();

    // Before acceptance: Budi is NOT in member table
    const membersBefore = (
      sharedMemoryDb.member as Array<Record<string, unknown>>
    ).filter((m) => m.organizationId === warungAsepOrgId);
    expect(membersBefore).toHaveLength(1);

    // Budi registers on pos-amir
    const budiSignUpRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/sign-up/email',
      payload: {
        name: 'Budi Kasir',
        email: 'budi@warung.id',
        password: 'Password123!',
      },
    });
    expect(budiSignUpRes.statusCode).toBe(200);
    const budiBody = budiSignUpRes.json() as {
      user: { id: string; tenantId: string };
    };
    budiAmirUserId = budiBody.user.id;
    expect(budiBody.user.tenantId).toBe(posAmirTenant.id);
    budiAmirCookie = buildCookieHeader(
      extractCookies(budiSignUpRes.headers['set-cookie']),
    );

    // Budi accepts invitation
    const acceptRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/organization/accept-invitation',
      headers: { cookie: budiAmirCookie },
      payload: { invitationId: budiInvitationId },
    });
    expect(acceptRes.statusCode).toBe(200);

    // After acceptance: Budi is member in Warung Asep on pos-amir
    const membersAfter = (
      sharedMemoryDb.member as Array<Record<string, unknown>>
    ).filter((m) => m.organizationId === warungAsepOrgId);
    expect(membersAfter).toHaveLength(2);
    const budiMember = membersAfter.find((m) => m.userId === budiAmirUserId);
    expect(budiMember).toBeDefined();
    expect(budiMember?.role).toBe('member');
  });

  it('should isolate portal user/org lists per tenant and reject cross-tenant setActiveOrganization & OAuth authorize/token with 403', async () => {
    // Portal users for pos-amir only show Asep & Budi (not Asep from sekolah-bima)
    const amirUsersRes = await app.inject({
      method: 'GET',
      url: `/api/portal/tenants/${posAmirTenant.id}/users`,
      headers: { cookie: amirCookie },
    });
    expect(amirUsersRes.statusCode).toBe(200);
    const amirUsers = (
      amirUsersRes.json() as {
        success: true;
        data: { items: Array<{ id: string; tenantId: string }> };
      }
    ).data.items;
    expect(amirUsers.map((u) => u.id).sort()).toEqual(
      [asepAmirUserId, budiAmirUserId].sort(),
    );
    expect(amirUsers.some((u) => u.id === asepBimaUserId)).toBe(false);
    expect(amirUsers.some((u) => u.id === bimaUserId)).toBe(false);

    // Portal orgs for pos-amir only show Warung Asep (not Kelas Bima)
    const amirOrgsRes = await app.inject({
      method: 'GET',
      url: `/api/portal/tenants/${posAmirTenant.id}/organizations`,
      headers: { cookie: amirCookie },
    });
    expect(amirOrgsRes.statusCode).toBe(200);
    const amirOrgs = (
      amirOrgsRes.json() as {
        success: true;
        data: { items: Array<{ id: string; tenantId: string }> };
      }
    ).data.items;
    expect(amirOrgs.map((o) => o.id)).toEqual([warungAsepOrgId]);
    expect(amirOrgs.some((o) => o.id === sekolahBimaOrgId)).toBe(false);

    // Cross-tenant setActiveOrganization rejected with 403
    const crossOrgRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/organization/set-active',
      headers: { cookie: asepAmirCookie },
      payload: { organizationId: sekolahBimaOrgId },
    });
    expect(crossOrgRes.statusCode).toBe(403);

    // Cross-tenant OAuth authorize using Bima's client_id on Amir's path rejected with 403
    const crossOAuthAuthorizeRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/auth/oauth2/authorize?client_id=${encodeURIComponent(bimaOAuthClientId)}&redirect_uri=${encodeURIComponent('http://localhost:4001/callback')}&response_type=code&scope=openid`,
      headers: { cookie: asepAmirCookie },
    });
    expect(crossOAuthAuthorizeRes.statusCode).toBe(403);

    // Cross-tenant OAuth token using Bima's client_id on Amir's path rejected with 403
    const crossOAuthTokenRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: bimaOAuthClientId,
        code: 'dummy-code',
        redirect_uri: 'http://localhost:4001/callback',
      }).toString(),
    });
    expect(crossOAuthTokenRes.statusCode).toBe(403);
    expect(amirOAuthClientId).toBeTruthy();
  });

  it('should enforce feature tiers, encrypted Google OAuth isolation, Social Bridge one-time exchange & unverified email rejection, path cookie isolation, and concurrent ALS isolation', async () => {
    // Verify auth_tiers only contains Free, Basic, Business, Enterprise
    expect(tiersStore.map((t) => t.name)).toEqual([
      'Free',
      'Basic',
      'Business',
      'Enterprise',
    ]);

    // Upgrade pos-amir to Business tier via BillingService + TenantService
    await billingService.recordBilling({
      tenantId: posAmirTenant.id,
      tierId: 'tier_business',
      amount: 499000,
      currency: 'IDR',
      status: 'paid',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400 * 1000),
      note: 'Upgrade to Business',
    });
    posAmirTenant = await tenantService.updateTenant(posAmirTenant.id, {
      tierId: 'tier_business',
    });

    // Verify read-only billing summary in portal
    const billingRes = await app.inject({
      method: 'GET',
      url: `/api/portal/tenants/${posAmirTenant.id}/billing`,
      headers: { cookie: amirCookie },
    });
    expect(billingRes.statusCode).toBe(200);
    expect(
      (billingRes.json() as { success: true; data: { tierId: string } }).data
        .tierId,
    ).toBe('tier_business');

    // Feature outside Free tier (e.g. sso on sekolah-bima Free tier) rejected with 403
    const outOfTierRes = await app.inject({
      method: 'PUT',
      url: `/api/portal/tenants/${sekolahBimaTenant.id}/features`,
      headers: { cookie: bimaCookie },
      payload: {
        featureCode: 'sso',
        enabled: true,
      },
    });
    expect(outOfTierRes.statusCode).toBe(403);

    // Amir enables socialGoogle + encrypted clientSecret on pos-amir (Business tier)
    const enableGoogleRes = await app.inject({
      method: 'PUT',
      url: `/api/portal/tenants/${posAmirTenant.id}/features`,
      headers: { cookie: amirCookie },
      payload: {
        featureCode: 'socialGoogle',
        enabled: true,
        settings: { clientId: 'amir-google-client-id' },
        secrets: { clientSecret: 'amir-super-secret-google-key' },
      },
    });
    expect(enableGoogleRes.statusCode).toBe(200);

    // GET features returns secretsConfigured: { clientSecret: true } and never leaks secret
    const getFeaturesRes = await app.inject({
      method: 'GET',
      url: `/api/portal/tenants/${posAmirTenant.id}/features`,
      headers: { cookie: amirCookie },
    });
    expect(getFeaturesRes.statusCode).toBe(200);
    const featuresText = getFeaturesRes.body;
    expect(featuresText).not.toContain('amir-super-secret-google-key');
    const googleFeature = (
      getFeaturesRes.json() as {
        success: true;
        data: Array<{
          featureCode: string;
          enabled: boolean;
          secretsConfigured: Record<string, boolean>;
        }>;
      }
    ).data.find((f) => f.featureCode === 'socialGoogle');
    expect(googleFeature?.enabled).toBe(true);
    expect(googleFeature?.secretsConfigured.clientSecret).toBe(true);

    // Verify stored secret is AES-256-GCM encrypted and decryptable by CryptoService
    const storedConfig = Array.from(tenantFeatureConfigsStore.values()).find(
      (c) =>
        c.tenantId === posAmirTenant.id && c.featureId === 'feat_socialGoogle',
    );
    expect(storedConfig?.secrets?.clientSecret?.ct).toBeTruthy();
    expect(
      cryptoService.decryptSecret(storedConfig!.secrets!.clientSecret!),
    ).toBe('amir-super-secret-google-key');

    // Config isolation via real AuthConfigController + ResponseEnvelopeInterceptor:
    // pos-amir has socialGoogle enabled, sekolah-bima & platform remain disabled
    const [amirCfgRes, bimaCfgRes, platformCfgRes] = await Promise.all([
      app.inject({ method: 'GET', url: '/t/pos-amir/api/auth-config' }),
      app.inject({ method: 'GET', url: '/t/sekolah-bima/api/auth-config' }),
      app.inject({ method: 'GET', url: '/api/auth-config' }),
    ]);
    expect(amirCfgRes.statusCode).toBe(200);
    expect(bimaCfgRes.statusCode).toBe(200);
    expect(platformCfgRes.statusCode).toBe(200);
    const amirCfgEnvelope = amirCfgRes.json() as {
      success: boolean;
      data: {
        features: FeatureConfigMap;
        capabilities: Record<string, { available: boolean }>;
      };
      meta: Record<string, unknown>;
    };
    const bimaCfgEnvelope = bimaCfgRes.json() as typeof amirCfgEnvelope;
    const platformCfgEnvelope = platformCfgRes.json() as typeof amirCfgEnvelope;
    expect(amirCfgEnvelope.success).toBe(true);
    expect(amirCfgEnvelope.meta).toBeDefined();
    expect(amirCfgEnvelope.data.capabilities.socialGoogle.available).toBe(true);
    expect(amirCfgEnvelope.data.features.socialGoogle.enabled).toBe(true);
    expect(
      amirCfgEnvelope.data.features.socialGoogle.secretsConfigured
        ?.clientSecret,
    ).toBe(true);
    expect(amirCfgRes.body).not.toContain('amir-super-secret-google-key');
    expect(bimaCfgEnvelope.success).toBe(true);
    expect(bimaCfgEnvelope.data.features.socialGoogle.enabled).toBe(false);
    expect(platformCfgEnvelope.success).toBe(true);
    expect(platformCfgEnvelope.data.features.socialGoogle.enabled).toBe(false);

    // Anti-open-redirect: external returnTo is rejected with 400
    const openRedirectRes = await app.inject({
      method: 'GET',
      url: '/t/pos-amir/api/social-bridge/start/google?returnTo=https://evil.com',
    });
    expect(openRedirectRes.statusCode).toBe(400);

    // Social Bridge: start -> callback -> one-time exchange
    const startRes = await app.inject({
      method: 'GET',
      url: '/t/pos-amir/api/social-bridge/start/google?returnTo=/dashboard',
    });
    expect(startRes.statusCode).toBe(302);
    const googleAuthUrl = new URL(String(startRes.headers.location));
    const signedState = googleAuthUrl.searchParams.get('state')!;
    expect(signedState).toBeTruthy();

    // Reject auto-link when emailVerified === false (during exchange on tenant host)
    socialBridgeProfileEmail = 'asep@warung.id';
    socialBridgeEmailVerified = false;
    const unverifiedCbRes = await app.inject({
      method: 'GET',
      url: `/api/social-bridge/callback/google?code=oauth-code-1&state=${encodeURIComponent(signedState)}`,
    });
    expect(unverifiedCbRes.statusCode).toBe(302);
    expect(unverifiedCbRes.headers['set-cookie']).toBeUndefined();
    const unverifiedExchangeRedirect = new URL(
      String(unverifiedCbRes.headers.location),
    );
    const unverifiedCode = unverifiedExchangeRedirect.searchParams.get('code')!;
    const unverifiedExchangeRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/social-bridge/exchange?code=${encodeURIComponent(unverifiedCode)}`,
    });
    expect(unverifiedExchangeRes.statusCode).toBe(403);
    expect(
      (unverifiedExchangeRes.json() as { code?: string }).code ??
        unverifiedExchangeRes.body,
    ).toContain('UNVERIFIED_SOCIAL_EMAIL');

    // Verified email succeeds and redirects from central host without Set-Cookie to tenant /t/:slug exchange
    socialBridgeProfileEmail = 'social-new@pos.id';
    socialBridgeEmailVerified = true;
    const verifiedCbRes = await app.inject({
      method: 'GET',
      url: `/api/social-bridge/callback/google?code=oauth-code-2&state=${encodeURIComponent(signedState)}`,
    });
    expect(verifiedCbRes.statusCode).toBe(302);
    expect(verifiedCbRes.headers['set-cookie']).toBeUndefined();
    const exchangeRedirect = new URL(String(verifiedCbRes.headers.location));
    expect(exchangeRedirect.pathname).toBe(
      '/t/pos-amir/api/social-bridge/exchange',
    );
    const exchangeCode = exchangeRedirect.searchParams.get('code')!;
    expect(exchangeCode).toBeTruthy();

    // Exchange on tenant path sets host-only signed cookie with Path=/t/pos-amir
    const exchangeRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/social-bridge/exchange?code=${encodeURIComponent(exchangeCode)}`,
    });
    expect(exchangeRes.statusCode).toBe(302);
    expect(exchangeRes.headers.location).toBe('/dashboard');
    const exchangeCookies = extractCookies(exchangeRes.headers['set-cookie']);
    expect(exchangeCookies.length).toBeGreaterThan(0);
    expect(exchangeCookies[0]).toContain('ac_t_pos-amir.session_token=');
    expect(exchangeCookies[0]).toContain('Path=/t/pos-amir');
    expect(exchangeCookies[0]).not.toMatch(/;\s*Domain=/i);

    // Follow-up request with the signed cookie from Social Bridge authenticates against Better Auth get-session
    const bridgeSessionRes = await app.inject({
      method: 'GET',
      url: '/t/pos-amir/api/auth/get-session',
      headers: { cookie: buildCookieHeader(exchangeCookies) },
    });
    expect(bridgeSessionRes.statusCode).toBe(200);
    const bridgeSessionBody = bridgeSessionRes.json() as {
      user?: { id: string; email: string; tenantId?: string };
    };
    expect(bridgeSessionBody?.user?.id).toBeTruthy();
    expect(bridgeSessionBody?.user?.email).toBe('social-new@pos.id');
    expect(bridgeSessionBody?.user?.tenantId).toBe(posAmirTenant.id);

    // Reusing one-time exchange code fails (GETDEL)
    const replayRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/social-bridge/exchange?code=${encodeURIComponent(exchangeCode)}`,
    });
    expect(replayRes.statusCode).toBe(401);

    // Path mode cookie isolation: pos-amir vs sekolah-bima
    const amirSignInRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/sign-in/email',
      payload: { email: 'asep@warung.id', password: 'Password123!' },
    });
    const bimaSignInRes = await app.inject({
      method: 'POST',
      url: '/t/sekolah-bima/api/auth/sign-in/email',
      payload: { email: 'asep@warung.id', password: 'Password123!' },
    });
    const amirSetCookies = extractCookies(amirSignInRes.headers['set-cookie']);
    const bimaSetCookies = extractCookies(bimaSignInRes.headers['set-cookie']);
    expect(amirSetCookies.some((c) => c.includes('ac_t_pos-amir'))).toBe(true);
    expect(amirSetCookies.some((c) => c.includes('Path=/t/pos-amir'))).toBe(
      true,
    );
    expect(bimaSetCookies.some((c) => c.includes('ac_t_sekolah-bima'))).toBe(
      true,
    );
    expect(bimaSetCookies.some((c) => c.includes('Path=/t/sekolah-bima'))).toBe(
      true,
    );

    // Concurrent parallel requests to 2 tenants keep ALS isolated
    const [concurrentAmir, concurrentBima] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/t/pos-amir/api/auth-config',
      }),
      app.inject({
        method: 'GET',
        url: '/t/sekolah-bima/api/auth-config',
      }),
    ]);
    expect(
      (
        concurrentAmir.json() as {
          success: true;
          data: { features: FeatureConfigMap };
        }
      ).data.features.socialGoogle.enabled,
    ).toBe(true);
    expect(
      (
        concurrentBima.json() as {
          success: true;
          data: { features: FeatureConfigMap };
        }
      ).data.features.socialGoogle.enabled,
    ).toBe(false);
  });

  it('should allow POS to read userId, tenantId, activeOrganizationId, orgRole & orgPermissions from OAuth 2.1 JWT Bearer token (<= 15m) and real-time /api/context/session', async () => {
    // Verify Access Token TTL <= 15 minutes (900s) and clamped helpers
    expect(MAX_ACCESS_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(900);
    expect(resolveClampedAccessTokenTtlSeconds(3600)).toBeLessThanOrEqual(900);
    expect(resolveClampedJwtExpirationTime('1h')).toBe('900s');

    // Set active organization for Asep on pos-amir
    const setActiveRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/organization/set-active',
      headers: { cookie: asepAmirCookie },
      payload: { organizationId: warungAsepOrgId },
    });
    expect(setActiveRes.statusCode).toBe(200);

    // Issue real OAuth 2.1 JWT Access Token via authorization_code + PKCE + consent + token
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const resourceUri = 'http://localhost:2001/api/auth/oauth2/userinfo';

    const authorizeParams = new URLSearchParams({
      client_id: amirOAuthClientId,
      redirect_uri: 'https://pos-app.example.com/callback',
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: resourceUri,
      state: 'oauth-acceptance-state',
    });
    const authorizeRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/auth/oauth2/authorize?${authorizeParams.toString()}`,
      headers: { cookie: asepAmirCookie },
    });
    expect(authorizeRes.statusCode).toBe(302);
    const authorizeLocation = new URL(
      String(authorizeRes.headers.location),
      'http://localhost:2001',
    );
    let authCode = authorizeLocation.searchParams.get('code');
    if (!authCode) {
      expect(authorizeLocation.pathname).toBe('/t/pos-amir/consent');
      const consentCookies = [
        asepAmirCookie,
        buildCookieHeader(extractCookies(authorizeRes.headers['set-cookie'])),
      ]
        .filter(Boolean)
        .join('; ');
      const consentRes = await app.inject({
        method: 'POST',
        url: '/t/pos-amir/api/auth/oauth2/consent',
        headers: { cookie: consentCookies },
        payload: {
          accept: true,
          oauth_query: authorizeLocation.search.slice(1),
        },
      });
      expect(consentRes.statusCode).toBe(200);
      const consentBody = consentRes.json() as { url: string };
      authCode = new URL(consentBody.url).searchParams.get('code');
    }
    expect(authCode).toBeTruthy();

    const basicCreds = Buffer.from(
      `${encodeURIComponent(amirOAuthClientId)}:${encodeURIComponent(amirOAuthClientSecret)}`,
      'utf8',
    ).toString('base64');
    const oauthTokenRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/oauth2/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basicCreds}`,
      },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode!,
        redirect_uri: 'https://pos-app.example.com/callback',
        code_verifier: codeVerifier,
        resource: resourceUri,
      }).toString(),
    });
    expect(oauthTokenRes.statusCode).toBe(200);
    const oauthTokenBody = oauthTokenRes.json() as {
      access_token: string;
      expires_in: number;
    };
    const oauthJwt = oauthTokenBody.access_token;
    expect(oauthJwt).toBeTruthy();
    expect(oauthJwt.split('.').length).toBe(3);
    expect(oauthTokenBody.expires_in).toBeLessThanOrEqual(900);

    const oauthClaims = decodeJwtPayload(oauthJwt);
    expect(oauthClaims.tenant_id).toBe(posAmirTenant.id);
    expect(oauthClaims.active_organization_id).toBe(warungAsepOrgId);
    expect(oauthClaims.org_role).toBe('owner');
    expect(Array.isArray(oauthClaims.org_permissions)).toBe(true);

    // Call /t/pos-amir/api/context/session directly with OAuth 2.1 JWT Bearer token
    const jwtSessionRes = await app.inject({
      method: 'GET',
      url: '/t/pos-amir/api/context/session',
      headers: { authorization: `Bearer ${oauthJwt}` },
    });
    expect(jwtSessionRes.statusCode).toBe(200);
    const jwtSessionBody = (
      jwtSessionRes.json() as {
        success: true;
        data: {
          userId: string;
          tenantId: string;
          activeOrganizationId: string | null;
          orgRole: string | null;
          orgPermissions: string[];
        };
      }
    ).data;
    expect(jwtSessionBody.userId).toBe(asepAmirUserId);
    expect(jwtSessionBody.tenantId).toBe(posAmirTenant.id);
    expect(jwtSessionBody.activeOrganizationId).toBe(warungAsepOrgId);
    expect(jwtSessionBody.orgRole).toBe('owner');
    expect(jwtSessionBody.orgPermissions.length).toBeGreaterThan(0);

    // Cross-tenant OAuth 2.1 JWT on sekolah-bima rejected (403/401)
    const crossJwtRes = await app.inject({
      method: 'GET',
      url: '/t/sekolah-bima/api/context/session',
      headers: { authorization: `Bearer ${oauthJwt}` },
    });
    expect([401, 403]).toContain(crossJwtRes.statusCode);

    // Issue short-TTL JWT from Better Auth jwt plugin on pos-amir
    const jwtRes = await app.inject({
      method: 'GET',
      url: '/t/pos-amir/api/auth/token',
      headers: { cookie: asepAmirCookie },
    });
    expect(jwtRes.statusCode).toBe(200);
    const jwtBody = jwtRes.json() as { token: string };
    expect(jwtBody.token).toBeTruthy();
    const jwtClaims = decodeJwtPayload(jwtBody.token);
    expect(jwtClaims.tenant_id).toBe(posAmirTenant.id);
    expect(jwtClaims.active_organization_id).toBe(warungAsepOrgId);
    expect(jwtClaims.org_role).toBe('owner');
    expect(Array.isArray(jwtClaims.org_permissions)).toBe(true);
    const iat = Number(jwtClaims.iat ?? 0);
    const exp = Number(jwtClaims.exp ?? 0);
    expect(exp - iat).toBeGreaterThan(0);
    expect(exp - iat).toBeLessThanOrEqual(900);

    // Create a Tenant API Key for POS backend via Better Auth api-key plugin
    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/t/pos-amir/api/auth/api-key/create',
      headers: { cookie: asepAmirCookie },
      payload: { name: 'POS Backend Key' },
    });
    expect(createKeyRes.statusCode).toBe(200);
    const createdKeyBody = createKeyRes.json() as { key: string };
    const rawApiKey = createdKeyBody.key;
    expect(rawApiKey).toBeTruthy();

    // Cross-tenant API Key usage on sekolah-bima is rejected with 403
    const crossTenantKeyRes = await app.inject({
      method: 'GET',
      url: '/t/sekolah-bima/api/context/session',
      headers: { 'x-api-key': rawApiKey },
    });
    expect(crossTenantKeyRes.statusCode).toBe(403);

    // Nonexistent userId queried via x-api-key returns 404
    const missingUserRes = await app.inject({
      method: 'GET',
      url: '/t/pos-amir/api/context/session?userId=usr_nonexistent',
      headers: { 'x-api-key': rawApiKey },
    });
    expect(missingUserRes.statusCode).toBe(404);

    // POS queries real-time /api/context/session using Tenant API Key
    const posSessionRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/context/session?userId=${encodeURIComponent(asepAmirUserId)}&organizationId=${encodeURIComponent(warungAsepOrgId)}`,
      headers: { 'x-api-key': rawApiKey },
    });
    expect(posSessionRes.statusCode).toBe(200);
    const posSession = (
      posSessionRes.json() as {
        success: true;
        data: {
          userId: string;
          tenantId: string;
          activeOrganizationId: string | null;
          orgRole: string | null;
          orgPermissions: string[];
        };
      }
    ).data;
    expect(posSession.userId).toBe(asepAmirUserId);
    expect(posSession.tenantId).toBe(posAmirTenant.id);
    expect(posSession.activeOrganizationId).toBe(warungAsepOrgId);
    expect(posSession.orgRole).toBe('owner');
    expect(Array.isArray(posSession.orgPermissions)).toBe(true);
    expect(posSession.orgPermissions.length).toBeGreaterThan(0);

    // Also verify Budi's real-time session reflects 'member' role
    const budiSessionRes = await app.inject({
      method: 'GET',
      url: `/t/pos-amir/api/context/session?userId=${encodeURIComponent(budiAmirUserId)}&organizationId=${encodeURIComponent(warungAsepOrgId)}`,
      headers: { 'x-api-key': rawApiKey },
    });
    expect(budiSessionRes.statusCode).toBe(200);
    const budiSession = (
      budiSessionRes.json() as {
        success: true;
        data: {
          userId: string;
          tenantId: string;
          activeOrganizationId: string | null;
          orgRole: string | null;
          orgPermissions: string[];
        };
      }
    ).data;
    expect(budiSession.userId).toBe(budiAmirUserId);
    expect(budiSession.tenantId).toBe(posAmirTenant.id);
    expect(budiSession.activeOrganizationId).toBe(warungAsepOrgId);
    expect(budiSession.orgRole).toBe('member');
    expect(budiSession.orgPermissions).toContain('member:read');
  });
});
