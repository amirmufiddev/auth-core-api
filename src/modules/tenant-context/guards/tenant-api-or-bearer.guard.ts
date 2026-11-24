import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyJwsAccessToken } from 'better-auth/oauth2';
import { AuthRuntimeRegistry } from '@/modules/auth';
import { TenantContextStorage } from '@/modules/tenant';
import type { TenantContextRequest } from '../dto/tenant-context.dto';
import { TenantContextService } from '../services/tenant-context.service';

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0]?.trim() || null;
  }
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function extractApiKey(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const xApiKey = readHeader(headers, 'x-api-key');
  if (xApiKey) return xApiKey;

  const authHeader = readHeader(headers, 'authorization');
  if (authHeader && /^ApiKey\s+/i.test(authHeader)) {
    return authHeader.replace(/^ApiKey\s+/i, '').trim() || null;
  }
  return null;
}

function toWebHeaders(
  headers: Record<string, string | string[] | undefined>,
): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) webHeaders.append(key, item);
      }
    } else if (typeof value === 'string') {
      webHeaders.set(key, value);
    }
  }
  return webHeaders;
}

@Injectable()
export class TenantApiOrBearerGuard implements CanActivate {
  constructor(
    private readonly authRuntimeRegistry: AuthRuntimeRegistry,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantContextRequest>();
    const tenantCtx = TenantContextStorage.get();

    if (!tenantCtx.tenantId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Endpoint ini hanya dapat diakses dalam konteks tenant.',
      });
    }

    await this.tenantContextService.assertTenantActive(tenantCtx.tenantId);

    const headers = request.headers ?? {};
    const apiKey = extractApiKey(headers);
    const authInstance =
      await this.authRuntimeRegistry.getForContext(tenantCtx);

    if (apiKey) {
      const verifyResult = await (
        authInstance.api as unknown as {
          verifyApiKey: (input: { body: { key: string } }) => Promise<{
            valid: boolean;
            key?: {
              id: string;
              referenceId: string;
              tenantId?: string | null;
            } | null;
          }>;
        }
      ).verifyApiKey({ body: { key: apiKey } });

      if (verifyResult?.valid && verifyResult.key) {
        let keyTenantId = verifyResult.key.tenantId;
        if (keyTenantId == null) {
          const record =
            await this.tenantContextService.findApiKeyRecord(apiKey);
          keyTenantId = record?.tenantId ?? null;
        }

        if (keyTenantId !== tenantCtx.tenantId) {
          throw new ForbiddenException({
            code: 'CROSS_TENANT_API_KEY',
            message:
              'API Key milik tenant lain tidak dapat digunakan pada konteks tenant ini.',
          });
        }

        request.tenantAuthContext = {
          authType: 'api_key',
          tenantId: tenantCtx.tenantId,
          userId: verifyResult.key.referenceId,
          activeOrganizationId: null,
          apiKeyId: verifyResult.key.id,
        };
        return true;
      }

      const existingKey =
        await this.tenantContextService.findApiKeyRecord(apiKey);
      if (existingKey && existingKey.tenantId !== tenantCtx.tenantId) {
        throw new ForbiddenException({
          code: 'CROSS_TENANT_API_KEY',
          message:
            'API Key milik tenant lain tidak dapat digunakan pada konteks tenant ini.',
        });
      }

      throw new UnauthorizedException('API Key tidak valid atau kedaluwarsa.');
    }

    const authHeader = readHeader(headers, 'authorization');
    const cookieHeader = readHeader(headers, 'cookie');
    if (!authHeader && !cookieHeader) {
      throw new UnauthorizedException(
        'Bearer token atau Tenant API Key diperlukan.',
      );
    }

    const bearerToken =
      authHeader && /^Bearer\s+/i.test(authHeader)
        ? authHeader.replace(/^Bearer\s+/i, '').trim() || null
        : null;

    let sessionResult: {
      user?: { id: string; tenantId?: string | null };
      session?: {
        tenantId?: string | null;
        activeOrganizationId?: string | null;
      };
    } | null = null;

    try {
      sessionResult = (await authInstance.api.getSession({
        headers: toWebHeaders(headers),
      })) as typeof sessionResult;
    } catch (error) {
      const status =
        (error as { statusCode?: number; status?: number })?.statusCode ??
        (error as { status?: number })?.status;
      if (status === 403) {
        throw new ForbiddenException({
          code: 'CROSS_TENANT_SESSION',
          message: 'Sesi tidak valid untuk konteks tenant ini.',
        });
      }
      if (!bearerToken) {
        throw new UnauthorizedException('Sesi atau Bearer token tidak valid.');
      }
    }

    if (sessionResult?.user?.id) {
      const userTenantId = sessionResult.user.tenantId;
      const sessionTenantId = sessionResult.session?.tenantId;
      if (
        (userTenantId !== undefined && userTenantId !== tenantCtx.tenantId) ||
        (sessionTenantId !== undefined &&
          sessionTenantId !== tenantCtx.tenantId)
      ) {
        throw new ForbiddenException({
          code: 'CROSS_TENANT_SESSION',
          message:
            'Sesi milik tenant lain tidak dapat digunakan di tenant ini.',
        });
      }

      request.tenantAuthContext = {
        authType: 'bearer',
        tenantId: tenantCtx.tenantId,
        userId: sessionResult.user.id,
        activeOrganizationId:
          sessionResult.session?.activeOrganizationId ?? null,
      };
      return true;
    }

    if (bearerToken) {
      const jwtClaims = await this.verifyBearerJwt(
        authInstance,
        bearerToken,
        tenantCtx.slug,
      );
      if (jwtClaims) {
        if (jwtClaims.tenant_id !== tenantCtx.tenantId) {
          throw new ForbiddenException({
            code: 'CROSS_TENANT_SESSION',
            message:
              'Bearer token milik tenant lain tidak dapat digunakan di tenant ini.',
          });
        }

        const userId =
          typeof jwtClaims.sub === 'string' ? jwtClaims.sub.trim() : '';
        if (!userId) {
          throw new UnauthorizedException(
            'Bearer token tidak memiliki subject pengguna.',
          );
        }

        await this.tenantContextService.validateJwtUserForTenant(
          userId,
          tenantCtx.tenantId,
        );

        const rawOrgId =
          jwtClaims.active_organization_id ?? jwtClaims.activeOrganizationId;
        const activeOrganizationId =
          typeof rawOrgId === 'string' && rawOrgId.trim()
            ? rawOrgId.trim()
            : null;

        request.tenantAuthContext = {
          authType: 'bearer',
          tenantId: tenantCtx.tenantId,
          userId,
          activeOrganizationId,
        };
        return true;
      }
    }

    throw new UnauthorizedException('Sesi atau Bearer token tidak valid.');
  }

  private async verifyBearerJwt(
    authInstance: unknown,
    token: string,
    tenantSlug?: string | null,
  ): Promise<Record<string, unknown> | null> {
    if (token.split('.').length !== 3) {
      return null;
    }

    const authApi = (authInstance as { api?: Record<string, unknown> })?.api;
    if (!authApi) return null;

    if (typeof authApi.verifyAccessToken === 'function') {
      try {
        const res = (await (
          authApi.verifyAccessToken as (input: unknown) => Promise<unknown>
        )({ body: { token } })) as Record<string, unknown> | null;
        return (
          (res?.payload as Record<string, unknown> | undefined) ?? res ?? null
        );
      } catch (err) {
        if (
          err instanceof ForbiddenException ||
          err instanceof UnauthorizedException
        ) {
          throw err;
        }
        return null;
      }
    }

    if (typeof authApi.getJwks !== 'function') {
      return null;
    }

    const { issuers, audiences } = await this.resolveIssuerAndAudience(
      authInstance,
      tenantSlug,
    );
    if (issuers.length === 0) return null;

    try {
      const payload = await verifyJwsAccessToken(token, {
        jwksFetch: async () =>
          (await (
            authApi.getJwks as () => Promise<{ keys: unknown[] } | undefined>
          )()) as Awaited<ReturnType<typeof verifyJwsAccessToken>> extends never
            ? never
            : any,
        jwksCacheKey: authInstance as object,
        verifyOptions: {
          issuer: issuers,
          audience: audiences,
        },
      });
      return payload as Record<string, unknown>;
    } catch (err) {
      if (
        err instanceof ForbiddenException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      return null;
    }
  }

  private async resolveIssuerAndAudience(
    authInstance: unknown,
    tenantSlug?: string | null,
  ): Promise<{ issuers: string[]; audiences: string[] }> {
    const instanceObj = authInstance as {
      options?: { baseURL?: string };
      $context?: Promise<{ baseURL?: string }>;
    };
    const optsBaseUrl = instanceObj.options?.baseURL?.replace(/\/+$/, '');
    let ctxBaseUrl: string | undefined;
    try {
      ctxBaseUrl = (await instanceObj.$context)?.baseURL?.replace(/\/+$/, '');
    } catch {
      ctxBaseUrl = undefined;
    }

    const issuers = Array.from(
      new Set([optsBaseUrl, ctxBaseUrl].filter((v): v is string => Boolean(v))),
    );
    const audienceSet = new Set<string>(issuers);

    for (const base of issuers) {
      try {
        const origin = new URL(base).origin;
        audienceSet.add(origin);
        audienceSet.add(`${base}/oauth2/userinfo`);
        audienceSet.add(`${origin}/api/auth/oauth2/userinfo`);
        audienceSet.add(`${origin}/mcp`);
        audienceSet.add(`${origin}/api/context`);
        if (tenantSlug) {
          audienceSet.add(`${origin}/t/${tenantSlug}`);
          audienceSet.add(`${origin}/t/${tenantSlug}/api/auth/oauth2/userinfo`);
          audienceSet.add(`${origin}/t/${tenantSlug}/mcp`);
          audienceSet.add(`${origin}/t/${tenantSlug}/api/context`);
        }
      } catch {
        audienceSet.add(`${base}/oauth2/userinfo`);
      }
    }

    return { issuers, audiences: Array.from(audienceSet) };
  }
}
