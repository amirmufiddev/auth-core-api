import * as crypto from 'node:crypto';
import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth';
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import {
  getTenantFromContext,
  multiTenant,
  tenantSessionHooks,
} from 'better-auth-multi-tenant';
import {
  RESERVED_TENANT_SLUGS,
  TenantContextStorage,
  type ResolvedTenantContext,
} from '@/modules/tenant';

export const CROSS_TENANT_OAUTH_CLIENT_ERROR = 'CROSS_TENANT_OAUTH_CLIENT';
export const TENANT_SUSPENDED_ERROR = 'TENANT_SUSPENDED';
export const CROSS_TENANT_SESSION_ERROR = 'CROSS_TENANT_SESSION';

export interface TenantCookieConfig {
  cookiePrefix: string;
  cookiePath: string;
}

export interface EnabledTenantPlugins {
  twoFactor: boolean;
  passkey: boolean;
  apiKey: boolean;
  deviceAuthorization: boolean;
  oauthProvider: boolean;
}

export interface TenantIsolationPluginOptions {
  staticTenantContext?: ResolvedTenantContext | null;
  tenantStatus?: 'active' | 'suspended';
  enabledPlugins: EnabledTenantPlugins;
}

type WhereOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

interface AdapterWhereCondition {
  field: string;
  value: string | number | boolean | string[] | number[] | Date | null;
  operator?: WhereOperator;
  connector?: 'AND' | 'OR';
}

interface AdapterQueryArgs {
  model: string;
  where?: AdapterWhereCondition[];
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

type AdapterMethod = (
  args: AdapterQueryArgs,
  ...rest: unknown[]
) => Promise<unknown>;

interface GenericAdapter {
  create?: AdapterMethod;
  findOne?: AdapterMethod;
  findMany?: AdapterMethod;
  count?: AdapterMethod;
  update?: AdapterMethod;
  updateMany?: AdapterMethod;
  delete?: AdapterMethod;
  deleteMany?: AdapterMethod;
  transaction?: (
    callback: (trx: GenericAdapter) => Promise<unknown>,
  ) => Promise<unknown>;
  [key: string]: unknown;
}

const TENANT_WRITE_MODELS = new Set([
  'user',
  'account',
  'session',
  'verification',
  'passkey',
  'twoFactor',
  'apikey',
  'deviceCode',
  'oauthClient',
  'oauthAccessToken',
  'oauthRefreshToken',
  'oauthConsent',
]);

// Do NOT filter 'session' or 'verification' reads here: better-auth-multi-tenant
// must be able to read foreign-tenant rows so it can reject them with
// 403 CROSS_TENANT_SESSION / 403 VERIFICATION_TENANT_MISMATCH instead of
// silently returning null (200 unauthenticated).
const TENANT_READ_FILTER_MODELS = new Set([
  'user',
  'account',
  'passkey',
  'twoFactor',
  'apikey',
  'deviceCode',
  'oauthAccessToken',
  'oauthRefreshToken',
  'oauthConsent',
]);

const OAUTH_GUARDED_PATHS = new Set([
  '/oauth2/authorize',
  '/oauth2/token',
  '/oauth2/consent',
  '/oauth2/continue',
  '/oauth2/introspect',
  '/oauth2/revoke',
  '/oauth2/public-client',
  '/oauth2/public-client-prelogin',
  '/oauth2/get-client',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/get-consent',
  '/oauth2/update-consent',
  '/oauth2/delete-consent',
  '/oauth2/userinfo',
]);

const ADAPTER_READ_METHODS = new Set([
  'findOne',
  'findMany',
  'count',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

export function resolveTenantCookieConfig(
  ctx:
    | Pick<ResolvedTenantContext, 'tenantId' | 'slug' | 'source'>
    | null
    | undefined,
): TenantCookieConfig {
  if (!ctx?.tenantId || !ctx.slug) {
    return {
      cookiePrefix: 'ac_platform',
      cookiePath: '/',
    };
  }

  return {
    cookiePrefix: `ac_t_${ctx.slug}`,
    cookiePath: ctx.source === 'path' ? `/t/${ctx.slug}` : '/',
  };
}

export function getEffectiveTenantContext(
  staticCtx?: ResolvedTenantContext | null,
  authContext?: unknown,
): ResolvedTenantContext {
  if (staticCtx && staticCtx.tenantId !== null) {
    return staticCtx;
  }

  const alsCtx = TenantContextStorage.get();
  if (alsCtx.tenantId !== null) {
    return alsCtx;
  }

  const pluginResolved = getTenantFromContext(authContext);
  if (pluginResolved?.tenant?.id) {
    return {
      tenantId: pluginResolved.tenant.id,
      slug: pluginResolved.slug,
      tierId: null,
      configVersion: 1,
      source: 'path',
    };
  }

  return alsCtx;
}

function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseBasicClientId(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader || !/^Basic\s+/i.test(authHeader)) {
    return null;
  }
  const encoded = authHeader.replace(/^Basic\s+/i, '').trim();
  if (!encoded) return null;

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    const rawId = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
    try {
      return decodeURIComponent(rawId) || null;
    } catch {
      return rawId || null;
    }
  } catch {
    return null;
  }
}

export function extractOAuthClientIdFromRequest(ctx: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Headers;
}): string | null {
  const queryClientId = ctx.query?.client_id;
  if (typeof queryClientId === 'string' && queryClientId.trim()) {
    return queryClientId.trim();
  }

  const bodyClientId = ctx.body?.client_id;
  if (typeof bodyClientId === 'string' && bodyClientId.trim()) {
    return bodyClientId.trim();
  }

  const oauthQuery = ctx.body?.oauth_query;
  if (typeof oauthQuery === 'string' && oauthQuery.trim()) {
    const params = new URLSearchParams(oauthQuery);
    const fromOAuthQuery = params.get('client_id');
    if (fromOAuthQuery && fromOAuthQuery.trim()) {
      return fromOAuthQuery.trim();
    }
  }

  const basicClientId = parseBasicClientId(ctx.headers?.get('authorization'));
  if (basicClientId) {
    return basicClientId;
  }

  const assertion = ctx.body?.client_assertion;
  if (typeof assertion === 'string' && assertion.includes('.')) {
    const payload = decodeJwtPayloadUnsafe(assertion);
    const subOrIss = payload?.sub ?? payload?.iss;
    if (typeof subOrIss === 'string' && subOrIss.trim()) {
      return subOrIss.trim();
    }
  }

  return null;
}

function extractCandidateTokens(ctx: {
  path?: string;
  body?: Record<string, unknown>;
  headers?: Headers;
}): string[] {
  const tokens: string[] = [];
  const rawToken = ctx.body?.token;
  if (typeof rawToken === 'string' && rawToken.trim()) {
    tokens.push(rawToken.trim().replace(/^Bearer\s+/i, ''));
  }

  const refreshToken = ctx.body?.refresh_token;
  if (typeof refreshToken === 'string' && refreshToken.trim()) {
    tokens.push(refreshToken.trim());
  }

  if (ctx.path === '/oauth2/userinfo') {
    const authHeader = ctx.headers?.get('authorization');
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      tokens.push(authHeader.replace(/^Bearer\s+/i, '').trim());
    }
    const accessToken = ctx.body?.access_token;
    if (typeof accessToken === 'string' && accessToken.trim()) {
      tokens.push(accessToken.trim());
    }
  }

  return tokens;
}

function appendTenantWhere(
  where: AdapterWhereCondition[] | undefined,
  tenantId: string | null,
): AdapterWhereCondition[] {
  const existing = Array.isArray(where) ? where : [];
  if (existing.some((clause) => clause.field === 'tenantId')) {
    return existing;
  }
  return [
    ...existing,
    {
      field: 'tenantId',
      value: tenantId,
      operator: 'eq',
      connector: 'AND',
    },
  ];
}

function wrapTenantScopedAdapter(
  baseAdapter: GenericAdapter,
  staticCtx?: ResolvedTenantContext | null,
): GenericAdapter {
  const wrap = (adapter: GenericAdapter): GenericAdapter =>
    new Proxy(adapter, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') {
          return value;
        }

        if (prop === 'transaction') {
          return (callback: (trx: GenericAdapter) => Promise<unknown>) =>
            (
              value as (
                cb: (t: GenericAdapter) => Promise<unknown>,
              ) => Promise<unknown>
            ).call(target, (trx) => callback(wrap(trx)));
        }

        if (prop === 'create') {
          return (args: AdapterQueryArgs, ...rest: unknown[]) => {
            if (!args || !TENANT_WRITE_MODELS.has(args.model)) {
              return (value as AdapterMethod).call(target, args, ...rest);
            }
            const tenantId = getEffectiveTenantContext(staticCtx).tenantId;
            if (tenantId !== null) {
              return (value as AdapterMethod).call(
                target,
                {
                  ...args,
                  data: {
                    ...args.data,
                    tenantId,
                  },
                },
                ...rest,
              );
            }
            if (args.model === 'user') {
              return (value as AdapterMethod).call(
                target,
                {
                  ...args,
                  data: {
                    ...args.data,
                    tenantId: null,
                  },
                },
                ...rest,
              );
            }
            return (value as AdapterMethod).call(target, args, ...rest);
          };
        }

        if (typeof prop === 'string' && ADAPTER_READ_METHODS.has(prop)) {
          return (args: AdapterQueryArgs, ...rest: unknown[]) => {
            if (!args) {
              return (value as AdapterMethod).call(target, args, ...rest);
            }
            const tenantId = getEffectiveTenantContext(staticCtx).tenantId;
            const shouldFilter =
              TENANT_READ_FILTER_MODELS.has(args.model) ||
              (args.model === 'oauthClient' && prop !== 'findOne');

            if (!shouldFilter) {
              return (value as AdapterMethod).call(target, args, ...rest);
            }

            // Platform context isolates user/oauthClient/token reads to tenantId IS NULL
            // and never lets tenant records leak into platform endpoints.
            const nextWhere = appendTenantWhere(args.where, tenantId);
            return (value as AdapterMethod).call(
              target,
              {
                ...args,
                where: nextWhere,
              },
              ...rest,
            );
          };
        }

        return (value as (...fnArgs: unknown[]) => unknown).bind(target);
      },
    });

  return wrap(baseAdapter);
}

function throwCrossTenantOAuthError(message: string): never {
  throw new APIError('FORBIDDEN', {
    code: CROSS_TENANT_OAUTH_CLIENT_ERROR,
    message,
  });
}

async function verifyOAuthClientOwnership(
  unscopedAdapter: GenericAdapter,
  clientId: string,
  expectedTenantId: string | null,
): Promise<void> {
  if (!unscopedAdapter.findOne) return;
  const client = (await unscopedAdapter.findOne({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  })) as { tenantId?: string | null } | null;

  if (client && (client.tenantId ?? null) !== expectedTenantId) {
    throwCrossTenantOAuthError(
      'OAuth client tidak thuộc tenant yang aktif pada request ini.',
    );
  }
}

async function verifyOAuthTokenOwnership(
  unscopedAdapter: GenericAdapter,
  token: string,
  expectedTenantId: string | null,
): Promise<void> {
  const jwtPayload = decodeJwtPayloadUnsafe(token);
  if (jwtPayload) {
    const claimTenant =
      (jwtPayload.tenant_id as string | undefined) ??
      (jwtPayload.tenantId as string | undefined);
    if (claimTenant !== undefined && claimTenant !== expectedTenantId) {
      throwCrossTenantOAuthError(
        'OAuth token tidak berasal dari tenant yang aktif.',
      );
    }

    const jwtClientId =
      (jwtPayload.azp as string | undefined) ??
      (jwtPayload.client_id as string | undefined);
    if (jwtClientId) {
      await verifyOAuthClientOwnership(
        unscopedAdapter,
        jwtClientId,
        expectedTenantId,
      );
    }
    return;
  }

  if (!unscopedAdapter.findOne) return;

  const sha256Base64Url = crypto
    .createHash('sha256')
    .update(token)
    .digest('base64url');
  const candidateValues = [token, sha256Base64Url];

  for (const model of ['oauthAccessToken', 'oauthRefreshToken']) {
    for (const candidate of candidateValues) {
      const row = (await unscopedAdapter.findOne({
        model,
        where: [{ field: 'token', value: candidate }],
      })) as { tenantId?: string | null; clientId?: string } | null;

      if (!row) continue;

      if ((row.tenantId ?? null) !== expectedTenantId) {
        throwCrossTenantOAuthError(
          'OAuth token milik tenant lain tidak dapat digunakan di tenant ini.',
        );
      }
      if (row.clientId) {
        await verifyOAuthClientOwnership(
          unscopedAdapter,
          row.clientId,
          expectedTenantId,
        );
      }
      return;
    }
  }
}

function buildDynamicTenantSchema(enabled: EnabledTenantPlugins) {
  const tenantIdField = {
    type: 'string' as const,
    required: false,
    input: false,
  };

  return {
    user: { fields: { tenantId: tenantIdField } },
    account: { fields: { tenantId: tenantIdField } },
    session: { fields: { tenantId: tenantIdField } },
    verification: { fields: { tenantId: tenantIdField } },
    ...(enabled.twoFactor
      ? { twoFactor: { fields: { tenantId: tenantIdField } } }
      : {}),
    ...(enabled.passkey
      ? { passkey: { fields: { tenantId: tenantIdField } } }
      : {}),
    ...(enabled.apiKey
      ? { apikey: { fields: { tenantId: tenantIdField } } }
      : {}),
    ...(enabled.deviceAuthorization
      ? { deviceCode: { fields: { tenantId: tenantIdField } } }
      : {}),
    ...(enabled.oauthProvider
      ? {
          oauthClient: { fields: { tenantId: tenantIdField } },
          oauthAccessToken: { fields: { tenantId: tenantIdField } },
          oauthRefreshToken: { fields: { tenantId: tenantIdField } },
          oauthConsent: { fields: { tenantId: tenantIdField } },
        }
      : {}),
  };
}

export function buildTenantIsolationPlugin(
  options: TenantIsolationPluginOptions,
) {
  let unscopedAdapter: GenericAdapter = {};

  return {
    id: 'authcore-tenant-isolation',
    schema: buildDynamicTenantSchema(options.enabledPlugins),
    init(ctx: { adapter: GenericAdapter }) {
      unscopedAdapter = ctx.adapter;
      return {
        context: {
          adapter: wrapTenantScopedAdapter(
            ctx.adapter,
            options.staticTenantContext,
          ),
        },
      };
    },
    hooks: {
      before: [
        {
          matcher: () => options.tenantStatus === 'suspended',
          handler: createAuthMiddleware(() =>
            Promise.reject(
              new APIError('FORBIDDEN', {
                code: TENANT_SUSPENDED_ERROR,
                message: 'Tenant sedang ditangguhkan.',
              }),
            ),
          ),
        },
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const effectiveCtx = getEffectiveTenantContext(
              options.staticTenantContext,
              ctx.context,
            );
            if (effectiveCtx.tenantId !== null) {
              return;
            }

            const cookieSession = await getSessionFromCtx(ctx, {
              disableRefresh: true,
            }).catch(() => null);
            const authHeader = ctx.headers?.get('authorization');
            let bearerSession: {
              session?: { tenantId?: string | null };
            } | null = null;
            if (authHeader && /^Bearer\s+/i.test(authHeader)) {
              const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
              const token = rawToken.split('.')[0];
              if (token && ctx.context.internalAdapter?.findSession) {
                bearerSession = (await ctx.context.internalAdapter
                  .findSession(token)
                  .catch(() => null)) as {
                  session?: { tenantId?: string | null };
                } | null;
              }
            }

            for (const sess of [cookieSession, bearerSession]) {
              const sessTenantId = (
                sess as { session?: { tenantId?: string | null } } | null
              )?.session?.tenantId;
              if (sessTenantId) {
                throw new APIError('FORBIDDEN', {
                  code: CROSS_TENANT_SESSION_ERROR,
                  message:
                    'Sesi tenant tidak dapat digunakan pada konteks platform.',
                });
              }
            }
          }),
        },
        {
          matcher: (ctx: { path?: string }) => ctx.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => {
            const rawEmail = (ctx.body as { email?: unknown } | undefined)
              ?.email;
            if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
              return;
            }
            const email = rawEmail.trim().toLowerCase();
            const tenantId = getEffectiveTenantContext(
              options.staticTenantContext,
              ctx.context,
            ).tenantId;

            const existing = await ctx.context.adapter.findOne({
              model: 'user',
              where: appendTenantWhere(
                [{ field: 'email', value: email }],
                tenantId,
              ),
            });
            if (existing) {
              throw new APIError('CONFLICT', {
                code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
                message: 'User already exists. Use another email.',
              });
            }
          }),
        },
        {
          matcher: (ctx: { path?: string }) =>
            Boolean(ctx.path && OAUTH_GUARDED_PATHS.has(ctx.path)),
          handler: createAuthMiddleware(async (ctx) => {
            const expectedTenantId = getEffectiveTenantContext(
              options.staticTenantContext,
              ctx.context,
            ).tenantId;

            const clientId = extractOAuthClientIdFromRequest({
              query: ctx.query as Record<string, unknown> | undefined,
              body: ctx.body as Record<string, unknown> | undefined,
              headers: ctx.headers,
            });
            if (clientId) {
              await verifyOAuthClientOwnership(
                unscopedAdapter,
                clientId,
                expectedTenantId,
              );
            }

            const candidateTokens = extractCandidateTokens({
              path: ctx.path,
              body: ctx.body as Record<string, unknown> | undefined,
              headers: ctx.headers,
            });
            for (const token of candidateTokens) {
              await verifyOAuthTokenOwnership(
                unscopedAdapter,
                token,
                expectedTenantId,
              );
            }
          }),
        },
      ],
    },
  };
}

export function createTenantMultiTenantPlugins(
  options: TenantIsolationPluginOptions,
): unknown[] {
  const staticCtx = options.staticTenantContext;
  const plugins: unknown[] = [];

  if (staticCtx?.tenantId && staticCtx.slug) {
    plugins.push(
      multiTenant({
        identity: 'tenant',
        reserved: [...RESERVED_TENANT_SLUGS],
        admin: false,
        sso: false,
        apiKeys: options.enabledPlugins.apiKey,
        deviceCodes: options.enabledPlugins.deviceAuthorization,
        bindVerifications: true,
        tenantCookies: false,
        sameOriginOnly: false,
        trustTenantOrigins: false,
        getTenantSlug: () => staticCtx.slug,
        getTenant: (slug) =>
          slug === staticCtx.slug
            ? {
                id: staticCtx.tenantId!,
                slug: staticCtx.slug!,
                status: 'active',
              }
            : null,
      }),
    );
  }

  plugins.push(buildTenantIsolationPlugin(options));
  return plugins;
}

function extractHookData<T extends object>(result: unknown, fallback: T): T {
  if (
    typeof result === 'object' &&
    result !== null &&
    'data' in result &&
    typeof result.data === 'object' &&
    result.data !== null
  ) {
    return result.data as T;
  }
  return fallback;
}

export function createTenantDatabaseHooks(options: {
  existingDatabaseHooks?: BetterAuthOptions['databaseHooks'];
  staticTenantContext?: ResolvedTenantContext | null;
}): NonNullable<BetterAuthOptions['databaseHooks']> {
  const existing = options.existingDatabaseHooks ?? {};
  const packageSessionHook = tenantSessionHooks({
    onMissingTenant: options.staticTenantContext?.tenantId ? 'reject' : 'allow',
  });

  const existingUserCreateBefore = existing.user?.create?.before;
  const existingUserUpdateBefore = existing.user?.update?.before;
  const existingSessionCreateBefore = existing.session?.create?.before;
  const existingAccountCreateBefore = existing.account?.create?.before;
  const existingVerificationCreateBefore =
    existing.verification?.create?.before;

  return {
    ...existing,
    user: {
      ...existing.user,
      create: {
        ...existing.user?.create,
        before: async (user, hookCtx) => {
          const baseResult = existingUserCreateBefore
            ? await existingUserCreateBefore(user, hookCtx)
            : undefined;
          if (baseResult === false) {
            return false;
          }
          const nextUser = extractHookData(baseResult, user);
          const tenantId = getEffectiveTenantContext(
            options.staticTenantContext,
            hookCtx?.context,
          ).tenantId;

          return {
            data: {
              ...nextUser,
              tenantId,
            },
          };
        },
      },
      ...(existingUserUpdateBefore
        ? {
            update: {
              ...existing.user?.update,
              before: existingUserUpdateBefore,
            },
          }
        : {}),
    },
    session: {
      ...existing.session,
      create: {
        ...existing.session?.create,
        before: async (session, hookCtx) => {
          const baseResult = existingSessionCreateBefore
            ? await existingSessionCreateBefore(session, hookCtx)
            : undefined;
          if (baseResult === false) {
            return false;
          }
          const workingSession = extractHookData(baseResult, session);

          const effectiveCtx = getEffectiveTenantContext(
            options.staticTenantContext,
            hookCtx?.context,
          );

          const pkgResult = effectiveCtx.tenantId
            ? await packageSessionHook.session.create.before(
                workingSession as Record<string, unknown>,
                hookCtx ?? null,
              )
            : undefined;
          const stampedSession = extractHookData(pkgResult, workingSession);

          const userId = (stampedSession as { userId?: string }).userId;
          if (userId && hookCtx?.context?.internalAdapter?.findUserById) {
            const owner = (await hookCtx.context.internalAdapter.findUserById(
              userId,
            )) as { tenantId?: string | null } | null;
            if (owner && (owner.tenantId ?? null) !== effectiveCtx.tenantId) {
              throw new APIError('FORBIDDEN', {
                code: CROSS_TENANT_SESSION_ERROR,
                message:
                  'Akun user tidak dapat membuat sesi pada konteks tenant ini.',
              });
            }
          }

          return {
            data: {
              ...stampedSession,
              tenantId: effectiveCtx.tenantId,
            },
          };
        },
      },
    },
    account: {
      ...existing.account,
      create: {
        ...existing.account?.create,
        before: async (accountRow, hookCtx) => {
          const baseResult = existingAccountCreateBefore
            ? await existingAccountCreateBefore(accountRow, hookCtx)
            : undefined;
          if (baseResult === false) {
            return false;
          }
          const nextAccount = extractHookData(baseResult, accountRow);
          const tenantId = getEffectiveTenantContext(
            options.staticTenantContext,
            hookCtx?.context,
          ).tenantId;

          return {
            data: {
              ...nextAccount,
              tenantId,
            },
          };
        },
      },
    },
    verification: {
      ...existing.verification,
      create: {
        ...existing.verification?.create,
        before: async (verificationRow, hookCtx) => {
          const baseResult = existingVerificationCreateBefore
            ? await existingVerificationCreateBefore(verificationRow, hookCtx)
            : undefined;
          if (baseResult === false) {
            return false;
          }
          const nextVerification = extractHookData(baseResult, verificationRow);
          const tenantId = getEffectiveTenantContext(
            options.staticTenantContext,
            hookCtx?.context,
          ).tenantId;

          return {
            data: {
              ...nextVerification,
              tenantId,
            },
          };
        },
      },
    },
  };
}
