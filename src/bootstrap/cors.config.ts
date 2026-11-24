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

export function configureCors(
  app: NestFastifyApplication,
  config: ConfigService,
): void {
  const nodeEnv =
    config.get<string>('app.nodeEnv', { infer: true }) ?? process.env.NODE_ENV;
  const rawCorsOrigins = config.get<string | string[]>('app.corsOrigins', {
    infer: true,
  });

  assertProductionCorsAllowed(nodeEnv, rawCorsOrigins);

  const explicitOrigins = parseCorsOrigins(rawCorsOrigins);
  if (explicitOrigins === null) {
    app.enableCors({
      origin: '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    });
    return;
  }

  const tenantBaseDomain =
    config.get<string>('TENANT_BASE_DOMAIN', { infer: true }) ??
    process.env.TENANT_BASE_DOMAIN ??
    'authcore.local';

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      callback(
        null,
        isAllowedTenantOrigin(requestOrigin, {
          explicitOrigins,
          tenantBaseDomain,
          nodeEnv,
        }),
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
}
