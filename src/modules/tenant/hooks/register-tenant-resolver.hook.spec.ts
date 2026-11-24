import 'reflect-metadata';
import {
  Controller,
  Get,
  Inject,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  SetMetadata,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as NestBetterAuthPkg from '@thallesp/nestjs-better-auth';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, mock } from 'bun:test';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import {
  TENANT_REPOSITORY_TOKEN,
  type ITenantRepository,
  type TenantSummaryCache,
} from '../interfaces/tenant-repository.interface';
import { TenantService } from '../services/tenant.service';
import {
  TenantContextStorage,
  type ResolvedTenantContext,
} from '../context/tenant-context.storage';
import {
  createTenantRewriteUrl,
  registerTenantResolverHook,
  type TenantRewriteRequest,
} from './register-tenant-resolver.hook';

const REAL_AUTH_TOKEN = Symbol('REAL_AUTH_TOKEN');

@Module({})
class RealFastifyBetterAuthModule implements NestModule {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(REAL_AUTH_TOKEN)
    private readonly authInstance: {
      options: { basePath?: string };
      handler: (req: Request) => Promise<Response>;
    },
  ) {}

  configure(_consumer: MiddlewareConsumer): void {
    // Mirrors @thallesp/nestjs-better-auth AuthModule.configure on Fastify
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
      module: RealFastifyBetterAuthModule,
      providers: [{ provide: REAL_AUTH_TOKEN, useValue: options.auth }],
    };
  }
}

function getBetterAuthTestModule(auth: {
  options: { basePath?: string };
  handler: (req: Request) => Promise<Response>;
}): DynamicModule {
  // When another spec in the shared bun test process mocked @thallesp/nestjs-better-auth,
  // AuthModule is a plain object rather than a Nest module class; use our faithful
  // Fastify + toNodeHandler mirror in that case, and real AuthModule otherwise.
  const pkgAuthModule = NestBetterAuthPkg.AuthModule as unknown as {
    forRoot: (opts: {
      auth: unknown;
      disableGlobalAuthGuard: boolean;
    }) => DynamicModule;
  };
  if (typeof NestBetterAuthPkg.AuthModule === 'function') {
    return pkgAuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: true,
    });
  }
  return RealFastifyBetterAuthModule.forRoot({ auth });
}

const AllowAnonymous = () => SetMetadata('PUBLIC', true);

@Controller()
class TenantProbeController {
  @Get('api/context/session')
  @Version(VERSION_NEUTRAL)
  @AllowAnonymous()
  getSessionContext() {
    return {
      context: TenantContextStorage.get(),
    };
  }

  @Get('api/auth-config')
  @Version(VERSION_NEUTRAL)
  @AllowAnonymous()
  getAuthConfig() {
    return {
      context: TenantContextStorage.get(),
    };
  }

  @Get('api/social-bridge/exchange')
  @Version(VERSION_NEUTRAL)
  @AllowAnonymous()
  getSocialExchange() {
    return {
      context: TenantContextStorage.get(),
    };
  }

  @Get('api/context/slow')
  @Version(VERSION_NEUTRAL)
  @AllowAnonymous()
  async getSlowContext() {
    const beforeAwait = TenantContextStorage.get();
    const delayMs = beforeAwait.slug === 'amir' ? 35 : 5;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const afterAwait = TenantContextStorage.get();
    return {
      beforeAwait,
      afterAwait,
    };
  }
}

describe('createTenantRewriteUrl & registerTenantResolverHook', () => {
  const createConfigMock = () =>
    ({
      get: mock(() => undefined),
    }) as unknown as ConfigService;

  const createBetterAuthStub = (observedInAuth: ResolvedTenantContext[]) => {
    const db = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const auth = betterAuth({
      basePath: '/api/auth',
      baseURL: 'http://localhost:2001',
      secret: 'test-secret-min-32-chars-here-for-testing-only',
      database: memoryAdapter(db),
      hooks: {
        before: () => {
          observedInAuth.push(TenantContextStorage.get());
          return Promise.resolve();
        },
      },
    });
    // Ensure /api/auth/slow-probe exercises async ALS inside Better Auth raw handler
    const originalHandler = auth.handler.bind(auth);
    return {
      ...auth,
      options: auth.options,
      api: auth.api,
      handler: async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/auth/als-probe') {
          const beforeAwait = TenantContextStorage.get();
          const delayMs = beforeAwait.slug === 'amir' ? 30 : 5;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          const afterAwait = TenantContextStorage.get();
          return Response.json({
            pathname: url.pathname,
            beforeAwait,
            afterAwait,
          });
        }
        return originalHandler(request);
      },
    };
  };

  const tenantMap: Record<string, TenantSummaryCache> = {
    'pos-amir': {
      id: 'ten_pos',
      slug: 'pos-amir',
      status: 'active',
      tierId: 'tier_business',
      configVersion: 3,
    },
    amir: {
      id: 'ten_amir',
      slug: 'amir',
      status: 'active',
      tierId: 'tier_free',
      configVersion: 1,
    },
    bima: {
      id: 'ten_bima',
      slug: 'bima',
      status: 'active',
      tierId: 'tier_basic',
      configVersion: 2,
    },
    'suspended-co': {
      id: 'ten_susp',
      slug: 'suspended-co',
      status: 'suspended',
      tierId: 'tier_free',
      configVersion: 1,
    },
  };

  it('should expose default platform context when TenantContextStorage.get is called outside run', () => {
    expect(TenantContextStorage.get()).toEqual({
      tenantId: null,
      slug: null,
      tierId: null,
      configVersion: 0,
      source: 'platform',
    });
  });

  it('should rewrite all /t/<slug>/api/* paths generically and synchronize req.raw.url', () => {
    const rewriteUrl = createTenantRewriteUrl();

    const makeReq = (url: string) =>
      ({
        url,
        raw: { url },
      }) as unknown as TenantRewriteRequest & { raw: TenantRewriteRequest };

    const reqAuth = makeReq('/t/pos-amir/api/auth/sign-in/email?next=/app');
    expect(rewriteUrl(reqAuth)).toBe('/api/auth/sign-in/email?next=/app');
    expect(reqAuth.__tenantPathSlug).toBe('pos-amir');
    expect(reqAuth.__tenantOriginalUrl).toBe(
      '/t/pos-amir/api/auth/sign-in/email?next=/app',
    );
    expect(reqAuth.url).toBe('/api/auth/sign-in/email?next=/app');
    expect(reqAuth.raw.url).toBe('/api/auth/sign-in/email?next=/app');

    const reqContext = makeReq('/t/POS-Amir/api/context/session');
    expect(rewriteUrl(reqContext)).toBe('/api/context/session');
    expect(reqContext.__tenantPathSlug).toBe('pos-amir');

    const reqConfig = makeReq('/t/pos-amir/api/auth-config');
    expect(rewriteUrl(reqConfig)).toBe('/api/auth-config');

    const reqSocial = makeReq('/t/pos-amir/api/social-bridge/exchange?code=1');
    expect(rewriteUrl(reqSocial)).toBe('/api/social-bridge/exchange?code=1');

    const reqApiRoot = makeReq('/t/pos-amir/api');
    expect(rewriteUrl(reqApiRoot)).toBe('/api');

    const reqNonApi = makeReq('/t/pos-amir/login');
    expect(rewriteUrl(reqNonApi)).toBe('/t/pos-amir/login');
    expect(reqNonApi.__tenantPathSlug).toBeUndefined();

    const reqApiDocs = makeReq('/t/pos-amir/api-docs');
    expect(rewriteUrl(reqApiDocs)).toBe('/t/pos-amir/api-docs');
    expect(reqApiDocs.__tenantPathSlug).toBeUndefined();

    const reqPlain = makeReq('/api/auth/get-session');
    expect(rewriteUrl(reqPlain)).toBe('/api/auth/get-session');
    expect(reqPlain.__tenantPathSlug).toBeUndefined();
  });

  it('should route /t/<slug>/api/auth/* and /t/<slug>/api/* without 404 and bind ALS through Better Auth and NestJS', async () => {
    const observedInAuth: ResolvedTenantContext[] = [];
    const lookupSpy = mock((slug: string) =>
      Promise.resolve(tenantMap[slug] ?? null),
    );
    const authStub = createBetterAuthStub(observedInAuth);

    const moduleRef = await Test.createTestingModule({
      imports: [getBetterAuthTestModule(authStub)],
      controllers: [TenantProbeController],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        rewriteUrl: createTenantRewriteUrl(),
        trustProxy: true,
      }),
    );

    registerTenantResolverHook(app, lookupSpy, [
      'localhost',
      'console.authcore.local',
    ]);
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();

    // 1. Better Auth /api/auth/ok through /t/<slug>/api/auth/ok must NOT 404
    const authOkRes = await fastify.inject({
      method: 'GET',
      url: '/t/pos-amir/api/auth/ok',
      headers: { host: 'localhost:2001' },
    });
    expect(authOkRes.statusCode).toBe(200);
    expect(observedInAuth.at(-1)).toEqual({
      tenantId: 'ten_pos',
      slug: 'pos-amir',
      tierId: 'tier_business',
      configVersion: 3,
      source: 'path',
    });

    // 2. Better Auth raw handler probe
    const authProbeRes = await fastify.inject({
      method: 'GET',
      url: '/t/pos-amir/api/auth/als-probe',
      headers: { host: 'localhost:2001' },
    });
    expect(authProbeRes.statusCode).toBe(200);
    expect(authProbeRes.json()).toEqual({
      pathname: '/api/auth/als-probe',
      beforeAwait: {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 3,
        source: 'path',
      },
      afterAwait: {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 3,
        source: 'path',
      },
    });

    // 3. All other /t/<slug>/api/* controller paths
    for (const path of [
      '/t/pos-amir/api/context/session',
      '/t/pos-amir/api/auth-config',
      '/t/pos-amir/api/social-bridge/exchange?code=abc',
    ]) {
      const res = await fastify.inject({
        method: 'GET',
        url: path,
        headers: { host: 'localhost:2001' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().context).toEqual({
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 3,
        source: 'path',
      });
    }

    // 4. Platform host bypasses tenant lookup when no /t/<slug> prefix
    lookupSpy.mockClear();
    const platformRes = await fastify.inject({
      method: 'GET',
      url: '/api/auth/als-probe',
      headers: { host: 'console.authcore.local' },
    });
    expect(platformRes.statusCode).toBe(200);
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(platformRes.json().beforeAwait).toEqual({
      tenantId: null,
      slug: null,
      tierId: null,
      configVersion: 0,
      source: 'platform',
    });

    // 5. Suspended tenant returns 403 TENANT_SUSPENDED
    const suspendedRes = await fastify.inject({
      method: 'GET',
      url: '/t/suspended-co/api/context/session',
      headers: { host: 'localhost:2001' },
    });
    expect(suspendedRes.statusCode).toBe(403);
    expect(suspendedRes.json().code).toBe('TENANT_SUSPENDED');

    // 6. Unknown or reserved slug returns 404 TENANT_NOT_FOUND
    const missingRes = await fastify.inject({
      method: 'GET',
      url: '/t/unknown-tenant/api/context/session',
      headers: { host: 'localhost:2001' },
    });
    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.json().code).toBe('TENANT_NOT_FOUND');

    const reservedRes = await fastify.inject({
      method: 'GET',
      url: '/t/admin/api/context/session',
      headers: { host: 'localhost:2001' },
    });
    expect(reservedRes.statusCode).toBe(404);
    expect(reservedRes.json().code).toBe('TENANT_NOT_FOUND');

    await app.close();
  });

  it('should read tenant summary from literal Redis key authcore:tenant:slug:<slug> with DB fallback', async () => {
    const cachedSummary: TenantSummaryCache = {
      id: 'ten_pos',
      slug: 'pos-amir',
      status: 'active',
      tierId: 'tier_enterprise',
      configVersion: 9,
    };

    const redisClient = {
      get: mock((key: string) =>
        Promise.resolve(
          key === 'authcore:tenant:slug:pos-amir'
            ? JSON.stringify(cachedSummary)
            : null,
        ),
      ),
      set: mock(() => Promise.resolve('OK')),
    };

    const tenantRepo: ITenantRepository = {
      findById: mock(() => Promise.resolve(null)),
      findBySlug: mock((slug: string) =>
        Promise.resolve(
          slug === 'db-only'
            ? {
                id: 'ten_db',
                name: 'DB Only',
                slug: 'db-only',
                ownerUserId: 'usr_1',
                tierId: 'tier_basic',
                status: 'active',
                billingStatus: 'active',
                configVersion: 4,
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            : null,
        ),
      ),
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      create: mock(),
      update: mock(),
      incrementConfigVersion: mock(() => Promise.resolve(1)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantProbeController],
      providers: [
        TenantService,
        { provide: TENANT_REPOSITORY_TOKEN, useValue: tenantRepo },
        { provide: BETTER_AUTH_REDIS_CLIENT, useValue: redisClient },
        { provide: ConfigService, useValue: createConfigMock() },
      ],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        rewriteUrl: createTenantRewriteUrl(),
        trustProxy: true,
      }),
    );

    const tenantService = app.get(TenantService);
    registerTenantResolverHook(
      app,
      (slug) => tenantService.resolveSlugSummary(slug),
      ['localhost'],
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();

    // Cache hit uses exact literal key without hitting DB
    const hitRes = await fastify.inject({
      method: 'GET',
      url: '/t/pos-amir/api/context/session',
    });
    expect(hitRes.statusCode).toBe(200);
    expect(redisClient.get).toHaveBeenCalledWith(
      'authcore:tenant:slug:pos-amir',
    );
    expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    expect(hitRes.json().context).toEqual({
      tenantId: 'ten_pos',
      slug: 'pos-amir',
      tierId: 'tier_enterprise',
      configVersion: 9,
      source: 'path',
    });

    // Cache miss falls back to DB and backfills literal Redis key
    const missRes = await fastify.inject({
      method: 'GET',
      url: '/t/db-only/api/context/session',
    });
    expect(missRes.statusCode).toBe(200);
    expect(redisClient.get).toHaveBeenCalledWith(
      'authcore:tenant:slug:db-only',
    );
    expect(tenantRepo.findBySlug).toHaveBeenCalledWith('db-only');
    expect(redisClient.set).toHaveBeenCalledWith(
      'authcore:tenant:slug:db-only',
      JSON.stringify({
        id: 'ten_db',
        slug: 'db-only',
        status: 'active',
        tierId: 'tier_basic',
        configVersion: 4,
      }),
      'EX',
      300,
    );

    await app.close();
  });

  it('should isolate AsyncLocalStorage across concurrent parallel requests for two different tenants', async () => {
    const authStub = createBetterAuthStub([]);
    const moduleRef = await Test.createTestingModule({
      imports: [getBetterAuthTestModule(authStub)],
      controllers: [TenantProbeController],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        rewriteUrl: createTenantRewriteUrl(),
        trustProxy: true,
      }),
    );

    registerTenantResolverHook(
      app,
      async (slug) => {
        // Introduce staggered lookup latency so tenant B resolves before tenant A
        await new Promise((resolve) =>
          setTimeout(resolve, slug === 'amir' ? 20 : 2),
        );
        return tenantMap[slug] ?? null;
      },
      ['localhost'],
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();

    const [ctrlAmir, ctrlBima, authAmir, authBima] = await Promise.all([
      fastify.inject({ method: 'GET', url: '/t/amir/api/context/slow' }),
      fastify.inject({ method: 'GET', url: '/t/bima/api/context/slow' }),
      fastify.inject({ method: 'GET', url: '/t/amir/api/auth/als-probe' }),
      fastify.inject({ method: 'GET', url: '/t/bima/api/auth/als-probe' }),
    ]);

    expect(ctrlAmir.statusCode).toBe(200);
    expect(ctrlBima.statusCode).toBe(200);
    expect(authAmir.statusCode).toBe(200);
    expect(authBima.statusCode).toBe(200);

    expect(ctrlAmir.json().beforeAwait.tenantId).toBe('ten_amir');
    expect(ctrlAmir.json().afterAwait.tenantId).toBe('ten_amir');
    expect(ctrlBima.json().beforeAwait.tenantId).toBe('ten_bima');
    expect(ctrlBima.json().afterAwait.tenantId).toBe('ten_bima');

    expect(authAmir.json().beforeAwait.tenantId).toBe('ten_amir');
    expect(authAmir.json().afterAwait.tenantId).toBe('ten_amir');
    expect(authBima.json().beforeAwait.tenantId).toBe('ten_bima');
    expect(authBima.json().afterAwait.tenantId).toBe('ten_bima');

    await app.close();
  });

  it('should reject host vs path tenant mismatch with 400 TENANT_MISMATCH', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantProbeController],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        rewriteUrl: createTenantRewriteUrl(),
        trustProxy: true,
      }),
    );

    registerTenantResolverHook(
      app,
      (slug) => Promise.resolve(tenantMap[slug] ?? null),
      ['localhost', 'console.authcore.local'],
      { tenantBaseDomain: 'authcore.local' },
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();
    const mismatchRes = await fastify.inject({
      method: 'GET',
      url: '/t/amir/api/context/session',
      headers: {
        'x-forwarded-host': 'bima.authcore.local:443',
      },
    });
    expect(mismatchRes.statusCode).toBe(400);
    expect(mismatchRes.json().code).toBe('TENANT_MISMATCH');

    await app.close();
  });

  it('should resolve wildcard subdomain pos-amir.authcore.local to ten_pos, bypass reserved hosts auth/console.authcore.local to platform, and reject pos-amir.authcore.local/t/bima with 400 TENANT_MISMATCH', async () => {
    const lookupSpy = mock((slug: string) =>
      Promise.resolve(tenantMap[slug] ?? null),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantProbeController],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        rewriteUrl: createTenantRewriteUrl(),
        trustProxy: true,
      }),
    );

    registerTenantResolverHook(
      app,
      lookupSpy,
      ['localhost', 'auth.authcore.local', 'console.authcore.local'],
      { tenantBaseDomain: 'authcore.local' },
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();

    // 1. Wildcard subdomain pos-amir.authcore.local resolves ten_pos with source: 'subdomain'
    const subRes = await fastify.inject({
      method: 'GET',
      url: '/api/context/session',
      headers: { host: 'pos-amir.authcore.local' },
    });
    expect(subRes.statusCode).toBe(200);
    expect(subRes.json().context).toEqual({
      tenantId: 'ten_pos',
      slug: 'pos-amir',
      tierId: 'tier_business',
      configVersion: 3,
      source: 'subdomain',
    });

    // 2. Reserved platform hosts auth.authcore.local & console.authcore.local bypass to Platform
    for (const platformHost of [
      'auth.authcore.local',
      'console.authcore.local',
    ]) {
      lookupSpy.mockClear();
      const platformRes = await fastify.inject({
        method: 'GET',
        url: '/api/context/session',
        headers: { host: platformHost },
      });
      expect(platformRes.statusCode).toBe(200);
      expect(lookupSpy).not.toHaveBeenCalled();
      expect(platformRes.json().context).toEqual({
        tenantId: null,
        slug: null,
        tierId: null,
        configVersion: 0,
        source: 'platform',
      });
    }

    // 3. Combined pos-amir.authcore.local/t/bima/... rejected with 400 TENANT_MISMATCH
    const mismatchRes = await fastify.inject({
      method: 'GET',
      url: '/t/bima/api/context/session',
      headers: { host: 'pos-amir.authcore.local' },
    });
    expect(mismatchRes.statusCode).toBe(400);
    expect(mismatchRes.json().code).toBe('TENANT_MISMATCH');

    await app.close();
  });
});
