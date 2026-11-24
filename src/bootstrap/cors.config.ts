import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { isAllowedTenantOrigin } from '@/modules/tenant';

function parseCorsOrigins(
  rawCorsOrigins: string | string[] | undefined,
): string[] | null {
  if (Array.isArray(rawCorsOrigins)) {
    const items = rawCorsOrigins.map((o) => o.trim()).filter(Boolean);
    return items.includes('*') ? null : items;
  }
  if (typeof rawCorsOrigins === 'string') {
    if (rawCorsOrigins.trim() === '*') {
      return null;
    }
    const items = rawCorsOrigins
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return items.includes('*') ? null : items;
  }
  return [];
}

function assertProductionCorsAllowed(
  nodeEnv: string | undefined,
  rawCorsOrigins: string | string[] | undefined,
): void {
  if (nodeEnv !== 'production') {
    return;
  }

  const hasWildcard =
    rawCorsOrigins === '*' ||
    (Array.isArray(rawCorsOrigins) && rawCorsOrigins.includes('*')) ||
    (typeof rawCorsOrigins === 'string' &&
      rawCorsOrigins
        .split(',')
        .map((s) => s.trim())
        .includes('*'));

  if (hasWildcard) {
    throw new Error('Wildcard origin (*) is not allowed in production');
  }
}

interface CorsOriginPolicy {
  wildcardAll: boolean;
  isAllowedOrigin: (requestOrigin?: string) => boolean;
}

export function resolveCorsOriginPolicy(
  config: ConfigService,
): CorsOriginPolicy {
  const nodeEnv =
    config.get<string>('app.nodeEnv', { infer: true }) ?? process.env.NODE_ENV;
  const rawCorsOrigins = config.get<string | string[]>('app.corsOrigins', {
    infer: true,
  });

  assertProductionCorsAllowed(nodeEnv, rawCorsOrigins);

  const explicitOrigins = parseCorsOrigins(rawCorsOrigins);
  if (explicitOrigins === null) {
    return {
      wildcardAll: true,
      isAllowedOrigin: () => true,
    };
  }

  const tenantBaseDomain =
    config.get<string>('TENANT_BASE_DOMAIN', { infer: true }) ??
    process.env.TENANT_BASE_DOMAIN ??
    'authcore.local';

  return {
    wildcardAll: false,
    isAllowedOrigin: (requestOrigin?: string) => {
      if (!requestOrigin) {
        return true;
      }
      return isAllowedTenantOrigin(requestOrigin, {
        explicitOrigins,
        tenantBaseDomain,
        nodeEnv,
      });
    },
  };
}

function getHeaderSingleValue(
  header: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

function appendVaryHeader(res: ServerResponse, value: string): void {
  const existing = res.getHeader('Vary');
  const existingStr =
    typeof existing === 'number'
      ? String(existing)
      : Array.isArray(existing)
        ? existing.join(', ')
        : existing;
  const values = new Set(
    existingStr
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? [],
  );
  values.add(value);
  res.setHeader('Vary', Array.from(values).join(', '));
}

/**
 * Handles CORS headers and OPTIONS preflight for `@thallesp/nestjs-better-auth`
 * when `disableTrustedOriginsCors: true` is enabled for dynamic tenant subdomains.
 */
export function createBetterAuthCorsMiddleware(config: ConfigService) {
  const policy = resolveCorsOriginPolicy(config);

  return (req: unknown, res: unknown, next: (err?: unknown) => void): void => {
    const nodeReq = ((req as { raw?: IncomingMessage })?.raw ??
      req) as IncomingMessage;
    const nodeRes = ((res as { raw?: ServerResponse })?.raw ??
      res) as ServerResponse;

    const origin = getHeaderSingleValue(nodeReq?.headers?.origin);
    if (!origin) {
      next();
      return;
    }

    const allowed = policy.wildcardAll || policy.isAllowedOrigin(origin);
    if (!allowed) {
      if (nodeReq.method?.toUpperCase() === 'OPTIONS') {
        nodeRes.statusCode = 403;
        nodeRes.setHeader('Content-Length', '0');
        nodeRes.end();
        return;
      }
      next();
      return;
    }

    nodeRes.setHeader('Access-Control-Allow-Origin', origin);
    nodeRes.setHeader('Access-Control-Allow-Credentials', 'true');
    appendVaryHeader(nodeRes, 'Origin');
    nodeRes.setHeader('Access-Control-Expose-Headers', 'set-auth-token');

    if (nodeReq.method?.toUpperCase() === 'OPTIONS') {
      const reqMethod = getHeaderSingleValue(
        nodeReq.headers['access-control-request-method'],
      );
      const reqHeaders = getHeaderSingleValue(
        nodeReq.headers['access-control-request-headers'],
      );
      nodeRes.setHeader(
        'Access-Control-Allow-Methods',
        reqMethod ?? 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
      );
      nodeRes.setHeader(
        'Access-Control-Allow-Headers',
        reqHeaders ?? 'Content-Type,Authorization,X-Api-Key',
      );
      if (reqHeaders) {
        appendVaryHeader(nodeRes, 'Access-Control-Request-Headers');
      }
      nodeRes.statusCode = 204;
      nodeRes.setHeader('Content-Length', '0');
      nodeRes.end();
      return;
    }

    next();
  };
}

export function configureCors(
  app: NestFastifyApplication,
  config: ConfigService,
): void {
  const policy = resolveCorsOriginPolicy(config);
  if (policy.wildcardAll) {
    app.enableCors({
      origin: '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    });
    return;
  }

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, policy.isAllowedOrigin(requestOrigin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
}
