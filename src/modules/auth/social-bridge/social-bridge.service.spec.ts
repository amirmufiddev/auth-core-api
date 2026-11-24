import 'reflect-metadata';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { describe, expect, it, mock } from 'bun:test';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import {
  createTenantRewriteUrl,
  registerTenantResolverHook,
  type TenantSummaryCache,
} from '@/modules/tenant';
import { SocialBridgeController } from './social-bridge.controller';
import { FetchSocialBridgeOAuthClient } from './social-bridge.oauth-client';
import {
  SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
  SOCIAL_BRIDGE_REPOSITORY_TOKEN,
  SocialBridgeService,
  type ISocialBridgeOAuthClient,
  type ISocialBridgeRepository,
} from './social-bridge.service';

function createInMemoryRedisMock() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    set: mock(
      async (key: string, value: string, _ex?: string, ttl?: number) => {
        store.set(key, { value, ttl });
        return 'OK';
      },
    ),
    getdel: mock(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      store.delete(key);
      return entry.value;
    }),
  };
}

function createConfigMock(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    BETTER_AUTH_SECRET: 'test-secret-min-32-chars-here-for-testing-only',
    BETTER_AUTH_URL: 'https://auth.authcore.local',
    TENANT_BASE_DOMAIN: 'authcore.local',
    SOCIAL_CALLBACK_BASE_URL: 'https://auth.authcore.local',
    ...overrides,
  };
  return {
    get: mock((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('SocialBridgeService & SocialBridgeController', () => {
  const createDeps = (options?: {
    existingUser?: { id: string; email: string; emailVerified: boolean } | null;
    existingAccount?: { id: string; userId: string } | null;
    oauthProfile?: {
      providerAccountId: string;
      email: string;
      name: string;
      emailVerified: boolean;
    };
  }) => {
    const redis = createInMemoryRedisMock();
    const configService = createConfigMock();

    const repo: ISocialBridgeRepository = {
      findTenantCredentials: mock(async (tenantId: string, provider: string) =>
        tenantId === 'ten_pos' && provider === 'google'
          ? { clientId: 'ten-pos-google-id', clientSecret: 'ten-pos-secret' }
          : null,
      ),
      findAccountByProvider: mock(async () => options?.existingAccount ?? null),
      findUserByTenantEmail: mock(async () => options?.existingUser ?? null),
      createUserWithAccount: mock(async (input) => ({
        userId: 'usr_new_1',
        email: input.email,
      })),
      linkAccountToUser: mock(async () => undefined),
      createSession: mock(async (input) => ({
        id: 'ses_1',
        token: input.token,
      })),
    };

    const oauthClient: ISocialBridgeOAuthClient = {
      exchangeCodeForProfile: mock(async () => ({
        providerAccountId:
          options?.oauthProfile?.providerAccountId ?? 'google-sub-123',
        email: options?.oauthProfile?.email ?? 'amir@pos.id',
        name: options?.oauthProfile?.name ?? 'Amir',
        emailVerified: options?.oauthProfile?.emailVerified ?? true,
      })),
    };

    const service = new SocialBridgeService(
      configService,
      redis as unknown as ConstructorParameters<typeof SocialBridgeService>[1],
      repo,
      oauthClient,
    );

    return { service, redis, repo, oauthClient, configService };
  };

  it('createSignedState builds returnOrigin purely on server and rejects open-redirect returnTo with 400 INVALID_RETURN_TO', () => {
    const { service } = createDeps();

    // Rejects external URL and protocol-relative URL
    for (const badReturnTo of [
      'https://evil.com',
      'http://evil.com/phish',
      '//evil.com',
      '//evil.com/path',
      'relative-no-slash',
    ]) {
      let caught: unknown;
      try {
        service.createSignedState({
          tenantId: 'ten_pos',
          tenantSlug: 'pos-amir',
          mode: 'subdomain',
          provider: 'google',
          returnTo: badReturnTo,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const httpErr = caught as {
        getStatus: () => number;
        getResponse: () => { code: string };
      };
      expect(httpErr.getStatus()).toBe(400);
      expect(httpErr.getResponse().code).toBe('INVALID_RETURN_TO');
    }

    // Accepts safe relative path and ignores any extra client-supplied returnOrigin
    const stateSub = service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'subdomain',
      provider: 'google',
      returnTo: '/dashboard?tab=overview',
      ...({ returnOrigin: 'https://attacker.example' } as Record<
        string,
        unknown
      >),
    });
    const decodedSub = service.verifySignedState(stateSub, 'google');
    expect(decodedSub.returnOrigin).toBe('https://pos-amir.authcore.local');
    expect(decodedSub.returnTo).toBe('/dashboard?tab=overview');

    const statePath = service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'path',
      provider: 'google',
      returnTo: '/app',
    });
    const decodedPath = service.verifySignedState(statePath, 'google');
    expect(decodedPath.returnOrigin).toBe('https://auth.authcore.local');
    expect(decodedPath.returnTo).toBe('/app');
  });

  it('handleCentralCallback exchanges code with tenant secret, stores one-time code in Redis (TTL 45s), and redirects outside /api/auth/* without Set-Cookie', async () => {
    const { service, redis, oauthClient } = createDeps();

    // Subdomain mode
    const subState = service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'subdomain',
      provider: 'google',
      returnTo: '/dashboard',
    });
    const subResult = await service.handleCentralCallback({
      provider: 'google',
      code: 'oauth-auth-code-1',
      state: subState,
    });

    expect(oauthClient.exchangeCodeForProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        code: 'oauth-auth-code-1',
        clientId: 'ten-pos-google-id',
        clientSecret: 'ten-pos-secret',
      }),
    );
    expect(subResult.redirectUrl).toMatch(
      /^https:\/\/pos-amir\.authcore\.local\/api\/social-bridge\/exchange\?code=[a-f0-9]+$/,
    );
    expect(subResult.redirectUrl).not.toContain('/api/auth/');

    // Verify Redis TTL = 45s
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^authcore:social-bridge:code:/),
      expect.any(String),
      'EX',
      45,
    );

    // Path mode
    const pathState = service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'path',
      provider: 'google',
      returnTo: '/home',
    });
    const pathResult = await service.handleCentralCallback({
      provider: 'google',
      code: 'oauth-auth-code-2',
      state: pathState,
    });
    expect(pathResult.redirectUrl).toMatch(
      /^https:\/\/auth\.authcore\.local\/t\/pos-amir\/api\/social-bridge\/exchange\?code=[a-f0-9]+$/,
    );
  });

  it('exchangeOnTenantHost consumes code via GETDEL (replay rejected 401), enforces tenantId match (403), and rejects unverified email auto-link (403 UNVERIFIED_SOCIAL_EMAIL)', async () => {
    // 1. Replay & tenant mismatch
    const { service, redis } = createDeps();
    const state = service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'subdomain',
      provider: 'google',
      returnTo: '/dashboard',
    });
    const { redirectUrl } = await service.handleCentralCallback({
      provider: 'google',
      code: 'oauth-code-1',
      state,
    });
    const oneTimeCode = new URL(redirectUrl).searchParams.get('code')!;

    const expectHttpError = async (
      promise: Promise<unknown>,
      status: number,
      code: string,
    ) => {
      let caught: unknown;
      try {
        await promise;
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const httpErr = caught as {
        getStatus: () => number;
        getResponse: () => { code: string };
      };
      expect(httpErr.getStatus()).toBe(status);
      expect(httpErr.getResponse().code).toBe(code);
    };

    // Wrong tenant consumes or is rejected with 403
    await expectHttpError(
      service.exchangeOnTenantHost(oneTimeCode, 'ten_other'),
      403,
      'TENANT_MISMATCH',
    );

    // Replay after GETDEL consumed it -> 401
    expect(redis.getdel).toHaveBeenCalledTimes(1);
    await expectHttpError(
      service.exchangeOnTenantHost(oneTimeCode, 'ten_pos'),
      401,
      'INVALID_EXCHANGE_CODE',
    );

    // 2. Valid exchange on matching tenant
    const { redirectUrl: redirectUrl2 } = await service.handleCentralCallback({
      provider: 'google',
      code: 'oauth-code-2',
      state,
    });
    const code2 = new URL(redirectUrl2).searchParams.get('code')!;
    const exchanged = await service.exchangeOnTenantHost(code2, 'ten_pos');
    expect(exchanged.sessionToken).toBeTruthy();
    expect(exchanged.redirectTo).toBe('/dashboard');

    // Replay of code2 -> 401
    await expectHttpError(
      service.exchangeOnTenantHost(code2, 'ten_pos'),
      401,
      'INVALID_EXCHANGE_CODE',
    );

    // 3. Existing user with emailVerified === false -> 403 UNVERIFIED_SOCIAL_EMAIL
    const unverifiedDeps = createDeps({
      existingUser: {
        id: 'usr_existing',
        email: 'amir@pos.id',
        emailVerified: true,
      },
      existingAccount: null,
      oauthProfile: {
        providerAccountId: 'google-sub-999',
        email: 'amir@pos.id',
        name: 'Amir',
        emailVerified: false,
      },
    });
    const unverifiedState = unverifiedDeps.service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'subdomain',
      provider: 'google',
      returnTo: '/dashboard',
    });
    const { redirectUrl: unverifiedRedirect } =
      await unverifiedDeps.service.handleCentralCallback({
        provider: 'google',
        code: 'oauth-code-unverified',
        state: unverifiedState,
      });
    const unverifiedCode = new URL(unverifiedRedirect).searchParams.get(
      'code',
    )!;
    await expectHttpError(
      unverifiedDeps.service.exchangeOnTenantHost(unverifiedCode, 'ten_pos'),
      403,
      'UNVERIFIED_SOCIAL_EMAIL',
    );
    expect(unverifiedDeps.repo.linkAccountToUser).not.toHaveBeenCalled();
  });

  it('SocialBridgeController sets NO Set-Cookie on central callback and sets host-only cookie on tenant exchange', async () => {
    const { redis, repo, oauthClient, configService } = createDeps();
    const tenantMap: Record<string, TenantSummaryCache> = {
      'pos-amir': {
        id: 'ten_pos',
        slug: 'pos-amir',
        status: 'active',
        tierId: 'tier_business',
        configVersion: 1,
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SocialBridgeController],
      providers: [
        SocialBridgeService,
        { provide: ConfigService, useValue: configService },
        { provide: BETTER_AUTH_REDIS_CLIENT, useValue: redis },
        { provide: SOCIAL_BRIDGE_REPOSITORY_TOKEN, useValue: repo },
        { provide: SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN, useValue: oauthClient },
      ],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        rewriteUrl: createTenantRewriteUrl(),
        trustProxy: true,
      }),
    );
    app.enableVersioning({ type: 0, defaultVersion: VERSION_NEUTRAL });
    registerTenantResolverHook(
      app,
      (slug) => Promise.resolve(tenantMap[slug] ?? null),
      ['localhost', 'auth.authcore.local'],
      { tenantBaseDomain: 'authcore.local' },
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();
    const service = app.get(SocialBridgeService);
    const state = service.createSignedState({
      tenantId: 'ten_pos',
      tenantSlug: 'pos-amir',
      mode: 'subdomain',
      provider: 'google',
      returnTo: '/dashboard',
    });

    // 1. Central callback on auth.authcore.local -> 302 redirect, NO Set-Cookie
    const cbRes = await fastify.inject({
      method: 'GET',
      url: `/api/social-bridge/callback/google?code=oauth-1&state=${encodeURIComponent(state)}`,
      headers: { host: 'auth.authcore.local' },
    });
    expect(cbRes.statusCode).toBe(302);
    expect(cbRes.headers['set-cookie']).toBeUndefined();
    const location = cbRes.headers.location as string;
    expect(location).toMatch(
      /^https:\/\/pos-amir\.authcore\.local\/api\/social-bridge\/exchange\?code=/,
    );

    // 2. Exchange on tenant host pos-amir.authcore.local -> 302 to /dashboard + host-only Set-Cookie
    const exchangeCode = new URL(location).searchParams.get('code')!;
    const exRes = await fastify.inject({
      method: 'GET',
      url: `/api/social-bridge/exchange?code=${encodeURIComponent(exchangeCode)}`,
      headers: { host: 'pos-amir.authcore.local' },
    });
    expect(exRes.statusCode).toBe(302);
    expect(exRes.headers.location).toBe('/dashboard');
    const setCookie = exRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    expect(cookieStr).toContain('ac_t_pos-amir.session_token=');
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('Path=/');
    expect(cookieStr.toLowerCase()).not.toContain('domain=');

    await app.close();
  });

  it('throws explicit error when BETTER_AUTH_SECRET is missing or empty', () => {
    const prevEnvSecret = process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;

    try {
      const redis = createInMemoryRedisMock();
      const emptyConfig = createConfigMock({ BETTER_AUTH_SECRET: '' });
      const repo = {} as ISocialBridgeRepository;
      const oauthClient = {} as ISocialBridgeOAuthClient;

      const service = new SocialBridgeService(
        emptyConfig,
        redis as unknown as ConstructorParameters<typeof SocialBridgeService>[1],
        repo,
        oauthClient,
      );

      expect(() =>
        service.createSignedState({
          tenantId: 'ten_pos',
          tenantSlug: 'pos-amir',
          mode: 'subdomain',
          provider: 'google',
          returnTo: '/dashboard',
        }),
      ).toThrow('BETTER_AUTH_SECRET is required for social bridge state signing');

      expect(() =>
        service.verifySignedState('abc.def', 'google'),
      ).toThrow('BETTER_AUTH_SECRET is required for social bridge state signing');
    } finally {
      if (prevEnvSecret !== undefined) {
        process.env.BETTER_AUTH_SECRET = prevEnvSecret;
      }
    }
  });

  it('FetchSocialBridgeOAuthClient falls back to GitHub /user/emails when /user email is null or verified is missing', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'gh-token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({ id: 42, login: 'amirmufid', name: 'Amir Mufid', email: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (target === 'https://api.github.com/user/emails') {
        return new Response(
          JSON.stringify([
            { email: 'secondary@example.com', primary: false, verified: true },
            { email: 'Amir@Pos.id', primary: true, verified: true },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const client = new FetchSocialBridgeOAuthClient();
      const profile = await client.exchangeCodeForProfile({
        provider: 'github',
        code: 'gh-code-1',
        clientId: 'gh-id',
        clientSecret: 'gh-secret',
        redirectUri: 'https://auth.authcore.local/api/social-bridge/callback/github',
      });

      expect(profile).toEqual({
        providerAccountId: '42',
        email: 'amir@pos.id',
        name: 'Amir Mufid',
        emailVerified: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
