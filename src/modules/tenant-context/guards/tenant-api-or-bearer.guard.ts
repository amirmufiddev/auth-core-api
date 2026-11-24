import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
    const authInstance = await this.authRuntimeRegistry.getForContext(tenantCtx);

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
      const status = (error as { statusCode?: number; status?: number })
        ?.statusCode ?? (error as { status?: number })?.status;
      if (status === 403) {
        throw new ForbiddenException({
          code: 'CROSS_TENANT_SESSION',
          message: 'Sesi tidak valid untuk konteks tenant ini.',
        });
      }
      throw new UnauthorizedException('Sesi atau Bearer token tidak valid.');
    }

    if (!sessionResult?.user?.id) {
      throw new UnauthorizedException('Sesi atau Bearer token tidak valid.');
    }

    const userTenantId = sessionResult.user.tenantId;
    const sessionTenantId = sessionResult.session?.tenantId;
    if (
      (userTenantId !== undefined && userTenantId !== tenantCtx.tenantId) ||
      (sessionTenantId !== undefined && sessionTenantId !== tenantCtx.tenantId)
    ) {
      throw new ForbiddenException({
        code: 'CROSS_TENANT_SESSION',
        message: 'Sesi milik tenant lain tidak dapat digunakan di tenant ini.',
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
}
