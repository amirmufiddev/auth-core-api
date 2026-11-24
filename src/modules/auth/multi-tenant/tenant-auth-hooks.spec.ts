import * as crypto from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { describe, expect, it, mock } from 'bun:test';
import { TenantContextStorage } from '@/modules/tenant';
import { createAuthInstance, type AuditLogInput } from '../auth';
import {
  buildDefaultFeatureConfigFromEnv,
  type FeatureConfigMap,
} from '../config/feature-catalog';
import {
  CROSS_TENANT_OAUTH_CLIENT_ERROR,
  resolveTenantCookieConfig,
  TENANT_SUSPENDED_ERROR,
} from './tenant-auth-hooks';

describe('tenant-auth-hooks & multi-tenant Better Auth isolation', () => {
  const createMockConfig = () =>
    ({
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
        return undefined;
      }),
    }) as unknown as ConfigService;

  const createFeatureConfig = (): FeatureConfigMap => {
    const fc = buildDefaultFeatureConfigFromEnv();
    fc.emailVerification.enabled = false;
    fc.rateLimit.enabled = false;
    fc.haveIBeenPwned.enabled = false;
    fc.oauthProvider.enabled = true;
    fc.jwt.enabled = true;
    fc.twoFactor.enabled = true;
    fc.apiKey.enabled = true;
    fc.deviceAuthorization.enabled = true;
    fc.passkey.enabled = true;
    fc.auditLogs.enabled = true;
    return fc;
  };

  const createSharedMemoryDb = (): MemoryDB => ({
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
    jwks: [],
    oauthClient: [],
    oauthResource: [],
    oauthClientResource: [],
    oauthClientAssertion: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
  });

  const extractCookiesMap = (res: Response): Record<string, string> => {
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie')?.split(/,(?=[^;]+=)/) ?? []);
    const map: Record<string, string> = {};
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) {
        map[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
    }
    return map;
  };

  const getSetCookies = (res: Response): string[] =>
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie')?.split(/,(?=[^;]+=)/) ?? []);

  it('should derive ac_t_<slug> with Path=/t/<slug> for path mode, Path=/ for subdomain mode, and ac_platform for platform', () => {
    expect(
      resolveTenantCookieConfig({
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        source: 'path',
      }),
    ).toEqual({
      cookiePrefix: 'ac_t_pos-amir',
      cookiePath: '/t/pos-amir',
    });

    expect(
      resolveTenantCookieConfig({
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        source: 'subdomain',
      }),
    ).toEqual({
      cookiePrefix: 'ac_t_pos-amir',
      cookiePath: '/',
    });

    expect(
      resolveTenantCookieConfig({
        tenantId: null,
        slug: null,
        source: 'platform',
      }),
    ).toEqual({
      cookiePrefix: 'ac_platform',
      cookiePath: '/',
    });
  });

  it('should isolate email user pool per tenant and reject duplicate email in the same tenant with 409', async () => {
    const sharedDb = createSharedMemoryDb();
    const fc = createFeatureConfig();
    const configService = createMockConfig();

    const authPos = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      tenantContext: {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 1,
        source: 'path',
      },
    });

    const authBima = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      tenantContext: {
        tenantId: 'ten_bima',
        slug: 'bima',
        tierId: 'tier_business',
        configVersion: 1,
        source: 'path',
      },
    });

    // 1. Sign up Asep on ten_pos
    const resPos1 = await authPos.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Asep POS',
          email: 'asep@warung.id',
          password: 'Password123!',
        }),
      }),
    );
    expect(resPos1.status).toBe(200);
    const posUser = sharedDb.user.find((u) => u.tenantId === 'ten_pos');
    expect(posUser).toBeDefined();
    expect(posUser?.email).toBe('asep@warung.id');
    expect(posUser?.tenantId).toBe('ten_pos');

    // 2. Same email signs up on ten_bima -> creates a separate user
    const resBima = await authBima.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Asep Bima',
          email: 'asep@warung.id',
          password: 'OtherPassword123!',
        }),
      }),
    );
    expect(resBima.status).toBe(200);
    const bimaUser = sharedDb.user.find((u) => u.tenantId === 'ten_bima');
    expect(bimaUser).toBeDefined();
    expect(bimaUser?.id).not.toBe(posUser?.id);
    expect(bimaUser?.tenantId).toBe('ten_bima');

    // 3. Same email signs up again on ten_pos -> rejected with 409
    const resPosDup = await authPos.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Asep Duplicate',
          email: 'asep@warung.id',
          password: 'Password123!',
        }),
      }),
    );
    expect(resPosDup.status).toBe(409);
  });

  it('should isolate path-mode cookies per slug so /t/bima login never overwrites /t/pos-amir or platform cookies', async () => {
    const sharedDb = createSharedMemoryDb();
    const fc = createFeatureConfig();
    const configService = createMockConfig();

    const authPos = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      tenantContext: {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_free',
        configVersion: 1,
        source: 'path',
      },
    });

    const authBima = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      tenantContext: {
        tenantId: 'ten_bima',
        slug: 'bima',
        tierId: 'tier_free',
        configVersion: 1,
        source: 'path',
      },
    });

    const authPlatform = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
    });

    const posRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'User Pos',
          email: 'pos@example.com',
          password: 'Password123!',
        }),
      }),
    );
    expect(posRes.status).toBe(200);
    const posSetCookies = getSetCookies(posRes);
    const posSessionCookie = posSetCookies.find((c) =>
      c.startsWith('ac_t_pos-amir.session_token='),
    );
    expect(posSessionCookie).toBeDefined();
    expect(posSessionCookie).toContain('Path=/t/pos-amir');

    const bimaRes = await authBima.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'User Bima',
          email: 'bima@example.com',
          password: 'Password123!',
        }),
      }),
    );
    expect(bimaRes.status).toBe(200);
    const bimaSetCookies = getSetCookies(bimaRes);
    const bimaSessionCookie = bimaSetCookies.find((c) =>
      c.startsWith('ac_t_bima.session_token='),
    );
    expect(bimaSessionCookie).toBeDefined();
    expect(bimaSessionCookie).toContain('Path=/t/bima');

    const platRes = await authPlatform.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Amir Platform',
          email: 'amir@platform.id',
          password: 'Password123!',
        }),
      }),
    );
    expect(platRes.status).toBe(200);
    const platSetCookies = getSetCookies(platRes);
    const platSessionCookie = platSetCookies.find((c) =>
      c.startsWith('ac_platform.session_token='),
    );
    expect(platSessionCookie).toBeDefined();
    expect(platSessionCookie).toContain('Path=/');

    // Sending pos-amir bearer token to bima must be rejected 403 CROSS_TENANT_SESSION
    const posData = await posRes.json();
    const crossSessionRes = await authBima.handler(
      new Request('http://localhost:2001/api/auth/get-session', {
        method: 'GET',
        headers: { authorization: `Bearer ${posData.token}` },
      }),
    );
    expect(crossSessionRes.status).toBe(403);
    expect((await crossSessionRes.json()).code).toBe('CROSS_TENANT_SESSION');

    // Pos cookie map still works on pos-amir even when other cookies are present
    const posCookies = extractCookiesMap(posRes);
    const bimaCookies = extractCookiesMap(bimaRes);
    const combinedCookieHeader = `ac_t_pos-amir.session_token=${posCookies['ac_t_pos-amir.session_token']}; ac_t_bima.session_token=${bimaCookies['ac_t_bima.session_token']}`;
    const posGetSession = await authPos.handler(
      new Request('http://localhost:2001/api/auth/get-session', {
        method: 'GET',
        headers: { cookie: combinedCookieHeader },
      }),
    );
    expect(posGetSession.status).toBe(200);
    const posSessionBody = await posGetSession.json();
    expect(posSessionBody?.user?.email).toBe('pos@example.com');

    // Sending pos-amir bearer token to Platform must also be rejected 403 CROSS_TENANT_SESSION
    const platCrossSessionRes = await authPlatform.handler(
      new Request('http://localhost:2001/api/auth/get-session', {
        method: 'GET',
        headers: { authorization: `Bearer ${posData.token}` },
      }),
    );
    expect(platCrossSessionRes.status).toBe(403);
    expect((await platCrossSessionRes.json()).code).toBe(
      'CROSS_TENANT_SESSION',
    );
  });

  it('should reject cross-tenant OAuth 2.1 client on authorize, token, consent, introspect, and revoke with 403 CROSS_TENANT_OAUTH_CLIENT', async () => {
    const sharedDb = createSharedMemoryDb();
    const fc = createFeatureConfig();
    const configService = createMockConfig();

    const bimaSecret = 'bima-secret-12345';
    const bimaSecretHash = crypto
      .createHash('sha256')
      .update(bimaSecret)
      .digest('base64url');

    sharedDb.oauthClient.push(
      {
        id: 'oa_pos',
        tenantId: 'ten_pos',
        clientId: 'client_pos',
        clientSecret: null,
        redirectUris: ['http://localhost:4000/callback'],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        tokenEndpointAuthMethod: 'none',
        requirePKCE: true,
        disabled: false,
        skipConsent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'oa_bima',
        tenantId: 'ten_bima',
        clientId: 'client_bima',
        clientSecret: bimaSecretHash,
        redirectUris: ['http://localhost:4001/callback'],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        requirePKCE: true,
        disabled: false,
        skipConsent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    const authPos = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      tenantContext: {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 1,
        source: 'path',
      },
    });

    // Sign in user on ten_pos so consent/authorize has a session
    const signUpRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Asep',
          email: 'asep@pos.id',
          password: 'Password123!',
        }),
      }),
    );
    const posCookies = extractCookiesMap(signUpRes);
    const cookieHeader = `ac_t_pos-amir.session_token=${posCookies['ac_t_pos-amir.session_token']}`;
    const basicBima = Buffer.from(`client_bima:${bimaSecret}`).toString(
      'base64',
    );

    // 1. authorize
    const authzRes = await authPos.handler(
      new Request(
        'http://localhost:2001/api/auth/oauth2/authorize?client_id=client_bima&response_type=code&redirect_uri=http://localhost:4001/callback&scope=openid&code_challenge=abc&code_challenge_method=S256',
        {
          method: 'GET',
          headers: { cookie: cookieHeader },
        },
      ),
    );
    expect(authzRes.status).toBe(403);
    expect((await authzRes.json()).code).toBe(CROSS_TENANT_OAUTH_CLIENT_ERROR);

    // 2. token (via form body client_id and via Basic auth)
    const tokenBodyRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'client_bima',
          code: 'fake-code',
          redirect_uri: 'http://localhost:4001/callback',
        }).toString(),
      }),
    );
    expect(tokenBodyRes.status).toBe(403);
    expect((await tokenBodyRes.json()).code).toBe(
      CROSS_TENANT_OAUTH_CLIENT_ERROR,
    );

    const tokenBasicRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/oauth2/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basicBima}`,
        },
        body: 'grant_type=client_credentials',
      }),
    );
    expect(tokenBasicRes.status).toBe(403);
    expect((await tokenBasicRes.json()).code).toBe(
      CROSS_TENANT_OAUTH_CLIENT_ERROR,
    );

    // 3. consent
    const consentRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/oauth2/consent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          accept: true,
          oauth_query: 'client_id=client_bima&scope=openid',
        }),
      }),
    );
    expect(consentRes.status).toBe(403);
    expect((await consentRes.json()).code).toBe(
      CROSS_TENANT_OAUTH_CLIENT_ERROR,
    );

    // 4. introspect
    const introspectRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/oauth2/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basicBima}`,
        },
        body: 'token=opaque-token-123',
      }),
    );
    expect(introspectRes.status).toBe(403);
    expect((await introspectRes.json()).code).toBe(
      CROSS_TENANT_OAUTH_CLIENT_ERROR,
    );

    // 5. revoke
    const revokeRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/oauth2/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basicBima}`,
        },
        body: 'token=opaque-token-123',
      }),
    );
    expect(revokeRes.status).toBe(403);
    expect((await revokeRes.json()).code).toBe(CROSS_TENANT_OAUTH_CLIENT_ERROR);
  });

  it('should reject auth and OAuth operations for suspended tenant with 403 TENANT_SUSPENDED', async () => {
    const sharedDb = createSharedMemoryDb();
    const fc = createFeatureConfig();
    const configService = createMockConfig();

    const authSuspended = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      tenantContext: {
        tenantId: 'ten_susp',
        slug: 'suspended-co',
        tierId: 'tier_free',
        configVersion: 1,
        source: 'path',
      },
      tenantStatus: 'suspended',
    });

    const signUpRes = await authSuspended.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Blocked User',
          email: 'blocked@susp.id',
          password: 'Password123!',
        }),
      }),
    );
    expect(signUpRes.status).toBe(403);
    expect((await signUpRes.json()).code).toBe(TENANT_SUSPENDED_ERROR);

    const tokenRes = await authSuspended.handler(
      new Request('http://localhost:2001/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'any_client',
        }).toString(),
      }),
    );
    expect(tokenRes.status).toBe(403);
    expect((await tokenRes.json()).code).toBe(TENANT_SUSPENDED_ERROR);
  });

  it('should propagate tenantId across session, verification, apikey, device_code, audit_trail_logs, oauth tables, account, passkey, and two_factor', async () => {
    const sharedDb = createSharedMemoryDb();
    const fc = createFeatureConfig();
    fc.emailVerification.enabled = true;
    const configService = createMockConfig();
    const auditLogs: AuditLogInput[] = [];

    const authPos = createAuthInstance({
      configService,
      featureConfig: fc,
      database: memoryAdapter(sharedDb),
      auditLogger: (entry) => {
        auditLogs.push(entry);
        return Promise.resolve();
      },
      tenantContext: {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 1,
        source: 'path',
      },
    });

    // 1. Sign up creates user, account, session, verification, audit_trail_logs
    const signUpRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Asep Warung',
          email: 'asep@warung.id',
          password: 'Password123!',
        }),
      }),
    );
    expect(signUpRes.status).toBe(200);
    const { user: createdUser } = await signUpRes.json();
    const posCookies = extractCookiesMap(signUpRes);
    const cookieHeader = `ac_t_pos-amir.session_token=${posCookies['ac_t_pos-amir.session_token']}`;

    // 1b. Trigger password-reset / verification row creation in DB
    await authPos.handler(
      new Request('http://localhost:2001/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'asep@warung.id',
          redirectTo: 'http://localhost:3000/reset-password',
        }),
      }),
    );

    expect(sharedDb.user.some((r) => r.tenantId === 'ten_pos')).toBe(true);
    expect(sharedDb.account.some((r) => r.tenantId === 'ten_pos')).toBe(true);
    expect(sharedDb.session.some((r) => r.tenantId === 'ten_pos')).toBe(true);
    expect(sharedDb.verification.some((r) => r.tenantId === 'ten_pos')).toBe(
      true,
    );
    expect(auditLogs.some((a) => a.tenantId === 'ten_pos')).toBe(true);

    // 2. twoFactor enable creates two_factor with tenantId
    const tfRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/two-factor/enable', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify({ password: 'Password123!' }),
      }),
    );
    expect(tfRes.status).toBe(200);
    expect(sharedDb.twoFactor.some((r) => r.tenantId === 'ten_pos')).toBe(true);

    // 3. apiKey create creates apikey with tenantId
    const apiKeyRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/api-key/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify({ name: 'POS Server Key' }),
      }),
    );
    expect(apiKeyRes.status).toBe(200);
    expect(sharedDb.apikey.some((r) => r.tenantId === 'ten_pos')).toBe(true);

    // 4. deviceAuthorization /device/code creates device_code with tenantId
    const deviceRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/device/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: 'pos-cli' }),
      }),
    );
    expect(deviceRes.status).toBe(200);
    expect(sharedDb.deviceCode.some((r) => r.tenantId === 'ten_pos')).toBe(
      true,
    );

    // 5. Real OAuth 2.1 authorize -> consent -> token flow propagates tenantId
    // to oauthConsent, oauthAccessToken, and oauthRefreshToken
    sharedDb.oauthClient.push({
      id: 'oa_pos_e2e',
      tenantId: 'ten_pos',
      clientId: 'client_pos_e2e',
      clientSecret: null,
      redirectUris: ['http://localhost:4000/callback'],
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      tokenEndpointAuthMethod: 'none',
      requirePKCE: true,
      disabled: false,
      skipConsent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const authzOkRes = await authPos.handler(
      new Request(
        `http://localhost:2001/api/auth/oauth2/authorize?client_id=client_pos_e2e&response_type=code&redirect_uri=${encodeURIComponent('http://localhost:4000/callback')}&scope=${encodeURIComponent('openid profile offline_access')}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
        {
          method: 'GET',
          headers: { cookie: cookieHeader },
        },
      ),
    );
    expect([200, 302]).toContain(authzOkRes.status);
    const location = authzOkRes.headers.get('location');
    expect(location).toBeTruthy();
    const authCode = new URL(location!).searchParams.get('code');
    expect(authCode).toBeTruthy();

    const tokenOkRes = await authPos.handler(
      new Request('http://localhost:2001/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'client_pos_e2e',
          code: authCode!,
          code_verifier: codeVerifier,
          redirect_uri: 'http://localhost:4000/callback',
        }).toString(),
      }),
    );
    expect(tokenOkRes.status).toBe(200);
    const tokenPayload = await tokenOkRes.json();
    expect(tokenPayload.access_token).toBeTruthy();
    expect(tokenPayload.refresh_token).toBeTruthy();

    // 6. Adapter-backed child rows (passkey, oauth_consent) also propagate tenantId
    const baCtx = await authPos.$context;
    await TenantContextStorage.run(
      {
        tenantId: 'ten_pos',
        slug: 'pos-amir',
        tierId: 'tier_business',
        configVersion: 1,
        source: 'path',
      },
      async () => {
        await baCtx.adapter.create({
          model: 'passkey',
          data: {
            name: 'MacBook TouchID',
            publicKey: 'pk-pub-1',
            userId: createdUser.id,
            credentialID: 'cred_1',
            counter: 0,
            deviceType: 'singleDevice',
            backedUp: false,
            transports: 'internal',
          },
        });

        await baCtx.adapter.create({
          model: 'oauthConsent',
          data: {
            clientId: 'client_pos_e2e',
            userId: createdUser.id,
            scopes: ['openid', 'profile'],
          },
        });
      },
    );

    expect(sharedDb.passkey.some((r) => r.tenantId === 'ten_pos')).toBe(true);
    expect(sharedDb.oauthConsent.some((r) => r.tenantId === 'ten_pos')).toBe(
      true,
    );
    expect(
      sharedDb.oauthRefreshToken.some((r) => r.tenantId === 'ten_pos'),
    ).toBe(true);
    expect(
      sharedDb.oauthAccessToken.some((r) => r.tenantId === 'ten_pos'),
    ).toBe(true);
  });
});
