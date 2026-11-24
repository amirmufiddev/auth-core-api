import { describe, expect, it, mock } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { AuthRuntimeRegistry } from './auth-runtime.registry';
import { createAuthInstance } from './auth';
import { getSharedPool } from '@/database/database.module';
import {
  DEFAULT_PLATFORM_TENANT_CONTEXT,
  TenantContextStorage,
  type ResolvedTenantContext,
} from '@/modules/tenant';
import { buildDefaultFeatureConfigFromEnv } from './config/feature-catalog';

function createMockConfigService(overrides: Record<string, unknown> = {}) {
  const appCfg = {
    nodeEnv: 'test',
    port: 3000,
    appName: 'AuthCore',
    appVersion: '1.0.0',
    corsOrigins: ['http://localhost:2000'],
    fallbackLanguage: 'id',
    baseUrl: 'http://localhost:3000',
  };
  const authCfg = {
    url: 'http://localhost:3000',
    secret: 'test-secret-minimum-32-characters-long',
    path: '/api/auth',
    google: { clientId: '', clientSecret: '' },
    useSecureCookies: false,
    clientUrl: 'http://localhost:2000',
    errorURL: 'http://localhost:2000/error',
    inviteURL: 'http://localhost:2000/invite',
    invitationExpiresIn: 172800,
    session: {
      expiresIn: 604800,
      updateAge: 86400,
      cookieCache: { enabled: true, maxAge: 300 },
    },
  };

  return {
    get: (key: string) => {
      if (key === 'app') return appCfg;
      if (key === 'auth') return authCfg;
      return overrides[key];
    },
  } as unknown as ConfigService;
}

function createMockRedis() {
  const store = new Map<string, string>();
  const listeners = new Map<string, Array<(channel: string, msg: string) => void>>();

  const subscriber = {
    connect: mock(async () => {}),
    subscribe: mock(async () => 1),
    unsubscribe: mock(async () => 1),
    quit: mock(async () => 'OK'),
    on: mock((event: string, cb: (channel: string, msg: string) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    }),
  };

  const client = {
    get: mock(async (key: string) => store.get(key) ?? null),
    set: mock(async (key: string, val: string) => {
      store.set(key, val);
      return 'OK';
    }),
    incr: mock(async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    }),
    publish: mock(async (channel: string, msg: string) => {
      const cbs = listeners.get('message') ?? [];
      for (const cb of cbs) {
        cb(channel, msg);
      }
      return cbs.length;
    }),
    duplicate: mock(() => subscriber),
    _store: store,
    _subscriber: subscriber,
  };

  return client;
}

describe('AuthRuntimeRegistry', () => {
  it('returns platformInstance when tenantId is null', async () => {
    const redis = createMockRedis();
    const registry = new AuthRuntimeRegistry(
      redis as any,
      createMockConfigService(),
    );

    const platformAuth = {
      options: { baseURL: 'http://localhost:3000' },
      api: { whoami: () => 'platform' },
      handler: async () => new Response('platform'),
    } as any;

    const buildTenantAuth = mock(async () => ({}) as any);

    registry.initialize({
      platformInstance: platformAuth,
      buildPlatformAuth: () => platformAuth,
      buildTenantAuth,
    });

    const resolved = await registry.getForContext(DEFAULT_PLATFORM_TENANT_CONTEXT);
    expect(resolved).toBe(platformAuth);
    expect(buildTenantAuth).not.toHaveBeenCalled();
  });

  it('scopes LRU keys by ${tenantId}:${source}:${configVersion}:${catalogVersion} and separates path vs subdomain instances', async () => {
    const redis = createMockRedis();
    const configService = createMockConfigService({
      TENANT_BASE_DOMAIN: 'authcore.local',
    });
    const registry = new AuthRuntimeRegistry(redis as any, configService);

    const sharedPool = getSharedPool();
    const sharedSecondaryStorage = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as any;

    const platformAuth = createAuthInstance({
      configService,
      secondaryStorage: sharedSecondaryStorage,
      featureConfig: buildDefaultFeatureConfigFromEnv(),
    });

    const builtKeys: string[] = [];
    registry.initialize({
      platformInstance: platformAuth,
      buildPlatformAuth: () => platformAuth,
      buildTenantAuth: (ctx, catalogVersion) => {
        builtKeys.push(
          `${ctx.tenantId}:${ctx.source}:${ctx.configVersion}:${catalogVersion}`,
        );
        return createAuthInstance({
          configService,
          secondaryStorage: sharedSecondaryStorage,
          tenantContext: ctx,
          tenantBaseDomain: 'authcore.local',
          featureConfig: buildDefaultFeatureConfigFromEnv(),
        });
      },
    });

    const pathCtx: ResolvedTenantContext = {
      tenantId: 'tenant-1',
      slug: 'acme',
      tierId: 'tier-pro',
      configVersion: 3,
      source: 'path',
    };
    const subdomainCtx: ResolvedTenantContext = {
      tenantId: 'tenant-1',
      slug: 'acme',
      tierId: 'tier-pro',
      configVersion: 3,
      source: 'subdomain',
    };

    const pathInstance = await registry.getForContext(pathCtx);
    const subdomainInstance = await registry.getForContext(subdomainCtx);

    expect(pathInstance).not.toBe(subdomainInstance);
    expect(builtKeys).toEqual([
      'tenant-1:path:3:0',
      'tenant-1:subdomain:3:0',
    ]);

    // Verify cookie Path & baseURL differ per source
    expect(pathInstance.options.advanced?.cookiePrefix).toBe('ac_t_acme');
    expect(pathInstance.options.advanced?.defaultCookieAttributes?.path).toBe(
      '/t/acme',
    );
    expect(pathInstance.options.baseURL).toBe('http://localhost:3000');

    expect(subdomainInstance.options.advanced?.cookiePrefix).toBe('ac_t_acme');
    expect(
      subdomainInstance.options.advanced?.defaultCookieAttributes?.path,
    ).toBe('/');
    expect(subdomainInstance.options.baseURL).toBe(
      'http://acme.authcore.local:3000',
    );

    // Verify shared pool & secondaryStorage references are identical
    expect(getSharedPool()).toBe(sharedPool);
    expect(pathInstance.options.secondaryStorage).toBe(sharedSecondaryStorage);
    expect(subdomainInstance.options.secondaryStorage).toBe(
      sharedSecondaryStorage,
    );

    // Subsequent lookup hits LRU cache without rebuilding
    const cachedPath = await registry.getForContext(pathCtx);
    expect(cachedPath).toBe(pathInstance);
    expect(builtKeys).toHaveLength(2);
  });

  it('increments authcore:catalog:version in Redis on invalidateCatalog() and lazily rebuilds tenant instances', async () => {
    const redis = createMockRedis();
    const registry = new AuthRuntimeRegistry(
      redis as any,
      createMockConfigService(),
    );

    let buildCount = 0;
    registry.initialize({
      platformInstance: {} as any,
      buildPlatformAuth: () => ({}) as any,
      buildTenantAuth: (ctx, catalogVersion) => {
        buildCount += 1;
        return {
          id: `inst-${buildCount}`,
          tenantId: ctx.tenantId,
          catalogVersion,
        } as any;
      },
    });

    const ctx: ResolvedTenantContext = {
      tenantId: 'tenant-2',
      slug: 'beta',
      tierId: 'tier-free',
      configVersion: 1,
      source: 'subdomain',
    };

    const first = (await registry.getForContext(ctx)) as any;
    expect(first.catalogVersion).toBe(0);
    expect(buildCount).toBe(1);

    const nextCatalogVersion = await registry.invalidateCatalog();
    expect(nextCatalogVersion).toBe(1);
    expect(redis.incr).toHaveBeenCalledWith('authcore:catalog:version');

    // Next lookup lazily rebuilds with new catalogVersion
    const second = (await registry.getForContext(ctx)) as any;
    expect(second).not.toBe(first);
    expect(second.catalogVersion).toBe(1);
    expect(buildCount).toBe(2);
  });

  it('defaults tenant Passkey rpID to TENANT_BASE_DOMAIN', () => {
    const configService = createMockConfigService({
      TENANT_BASE_DOMAIN: 'authcore.id',
    });
    const fc = buildDefaultFeatureConfigFromEnv();
    fc.passkey = { enabled: true, settings: {} };

    const tenantAuth = createAuthInstance({
      configService,
      tenantBaseDomain: 'authcore.id',
      tenantContext: {
        tenantId: 'tenant-pk',
        slug: 'gamma',
        tierId: 'tier-pro',
        configVersion: 1,
        source: 'subdomain',
      },
      featureConfig: fc,
    });

    const passkeyPlugin = (tenantAuth.options.plugins ?? []).find(
      (p: any) => p?.id === 'passkey',
    ) as any;
    expect(passkeyPlugin).toBeDefined();
    expect(passkeyPlugin.options?.rpID).toBe('authcore.id');
  });

  it('evicts least-recently-used entries when exceeding AUTH_RUNTIME_LRU_MAX', async () => {
    const redis = createMockRedis();
    const registry = new AuthRuntimeRegistry(
      redis as any,
      createMockConfigService({ AUTH_RUNTIME_LRU_MAX: 2 }),
    );

    let buildCount = 0;
    registry.initialize({
      platformInstance: {} as any,
      buildPlatformAuth: () => ({}) as any,
      buildTenantAuth: (ctx) => {
        buildCount += 1;
        return { tenantId: ctx.tenantId, seq: buildCount } as any;
      },
      maxEntries: 2,
    });

    const ctxA: ResolvedTenantContext = {
      tenantId: 't-a',
      slug: 'a',
      tierId: null,
      configVersion: 1,
      source: 'subdomain',
    };
    const ctxB: ResolvedTenantContext = {
      tenantId: 't-b',
      slug: 'b',
      tierId: null,
      configVersion: 1,
      source: 'subdomain',
    };
    const ctxC: ResolvedTenantContext = {
      tenantId: 't-c',
      slug: 'c',
      tierId: null,
      configVersion: 1,
      source: 'subdomain',
    };

    const instA1 = await registry.getForContext(ctxA);
    const instB1 = await registry.getForContext(ctxB);
    // Touch A so B becomes LRU
    expect(await registry.getForContext(ctxA)).toBe(instA1);

    // Insert C -> evicts B
    await registry.getForContext(ctxC);

    // A is still cached
    expect(await registry.getForContext(ctxA)).toBe(instA1);
    // B was evicted and must be rebuilt
    const instB2 = await registry.getForContext(ctxB);
    expect(instB2).not.toBe(instB1);
  });

  it('routes createContextAwareProxy() handler and api calls using TenantContextStorage', async () => {
    const redis = createMockRedis();
    const registry = new AuthRuntimeRegistry(
      redis as any,
      createMockConfigService(),
    );

    const platformAuth = {
      api: {
        whoami: async () => 'platform',
      },
      handler: async () => new Response('platform'),
    } as any;

    const tenantAuth = {
      api: {
        whoami: async () => 'tenant-acme',
      },
      handler: async () => new Response('tenant-acme'),
    } as any;

    registry.initialize({
      platformInstance: platformAuth,
      buildPlatformAuth: () => platformAuth,
      buildTenantAuth: () => tenantAuth,
    });

    const proxy = registry.createContextAwareProxy() as any;

    const platformRes = await proxy.handler(new Request('http://localhost/test'));
    expect(await platformRes.text()).toBe('platform');
    expect(await proxy.api.whoami()).toBe('platform');

    const tenantCtx: ResolvedTenantContext = {
      tenantId: 't-acme',
      slug: 'acme',
      tierId: null,
      configVersion: 1,
      source: 'path',
    };

    await TenantContextStorage.run(tenantCtx, async () => {
      const tenantRes = await proxy.handler(new Request('http://localhost/test'));
      expect(await tenantRes.text()).toBe('tenant-acme');
      expect(await proxy.api.whoami()).toBe('tenant-acme');
    });
  });

  it('subscribes to authcore:config:invalidated via dedicated Redis duplicate client and handles tenant/catalog/platform invalidations', async () => {
    const redis = createMockRedis();
    const registry = new AuthRuntimeRegistry(
      redis as any,
      createMockConfigService(),
    );

    let platformSeq = 0;
    let tenantSeq = 0;
    registry.initialize({
      platformInstance: { seq: 0 } as any,
      buildPlatformAuth: () => {
        platformSeq += 1;
        return { seq: platformSeq } as any;
      },
      buildTenantAuth: (ctx, catalogVersion) => {
        tenantSeq += 1;
        return {
          tenantId: ctx.tenantId,
          catalogVersion,
          seq: tenantSeq,
        } as any;
      },
    });

    await registry.onModuleInit();
    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    expect(redis._subscriber.subscribe).toHaveBeenCalledWith(
      'authcore:config:invalidated',
    );

    const ctx: ResolvedTenantContext = {
      tenantId: 't-pubsub',
      slug: 'pubsub',
      tierId: null,
      configVersion: 1,
      source: 'subdomain',
    };

    const t1 = (await registry.getForContext(ctx)) as any;
    expect(t1.seq).toBe(1);

    // Tenant invalidation via Pub/Sub evicts cached tenant instance
    await redis.publish(
      'authcore:config:invalidated',
      JSON.stringify({ scope: 'tenant', tenantId: 't-pubsub', configVersion: 1 }),
    );
    await Promise.resolve();
    const t2 = (await registry.getForContext(ctx)) as any;
    expect(t2).not.toBe(t1);
    expect(t2.seq).toBe(2);

    // Catalog invalidation via Pub/Sub updates catalogVersion and lazily rebuilds
    await redis.publish(
      'authcore:config:invalidated',
      JSON.stringify({ scope: 'catalog', catalogVersion: 5 }),
    );
    await Promise.resolve();
    const t3 = (await registry.getForContext(ctx)) as any;
    expect(t3.catalogVersion).toBe(5);
    expect(t3.seq).toBe(3);

    // Platform invalidation via Pub/Sub rebuilds platformInstance
    await redis.publish(
      'authcore:config:invalidated',
      JSON.stringify({ scope: 'platform' }),
    );
    await Promise.resolve();
    const p = (await registry.getForContext(
      DEFAULT_PLATFORM_TENANT_CONTEXT,
    )) as any;
    expect(p.seq).toBe(1);

    await registry.onModuleDestroy();
    expect(redis._subscriber.unsubscribe).toHaveBeenCalledWith(
      'authcore:config:invalidated',
    );
    expect(redis._subscriber.quit).toHaveBeenCalledTimes(1);
  });
});
