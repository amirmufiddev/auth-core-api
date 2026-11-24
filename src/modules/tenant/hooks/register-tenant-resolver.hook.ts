import type { IncomingMessage } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@/config/env.validation';
import {
  TenantContextStorage,
  type ResolvedTenantContext,
} from '../context/tenant-context.storage';
import type { TenantSummaryCache } from '../interfaces/tenant-repository.interface';
import { isReservedTenantSlug } from '../utils/tenant-validation.util';

const TENANT_API_PATH_PATTERN = /^\/t\/([^/?#]+)(\/api(?:\/.*|\?.*|#.*)?)$/;

export interface TenantRewriteRequest extends IncomingMessage {
  __tenantPathSlug?: string;
  __tenantOriginalUrl?: string;
  originalUrl?: string;
}

export interface TenantResolverHookOptions {
  tenantBaseDomain?: string;
  trustProxy?: boolean;
}

type FastifyOnRequestCallback = (
  req: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
) => void;

function decodeSlugSegment(rawSegment: string): string {
  try {
    return decodeURIComponent(rawSegment).trim().toLowerCase();
  } catch {
    return rawSegment.trim().toLowerCase();
  }
}

export function extractTenantPathRewrite(rawUrl: string): {
  slug: string;
  rewrittenUrl: string;
} | null {
  const match = TENANT_API_PATH_PATTERN.exec(rawUrl);
  if (!match) {
    return null;
  }

  const slug = decodeSlugSegment(match[1]);
  if (!slug) {
    return null;
  }

  return {
    slug,
    rewrittenUrl: match[2],
  };
}

function syncRequestUrls(
  req: TenantRewriteRequest,
  originalUrl: string,
  slug: string,
  rewrittenUrl: string,
): void {
  req.__tenantOriginalUrl = originalUrl;
  req.__tenantPathSlug = slug;
  req.url = rewrittenUrl;

  const nestedRaw = (
    req as TenantRewriteRequest & { raw?: TenantRewriteRequest }
  ).raw;
  if (nestedRaw && typeof nestedRaw === 'object') {
    nestedRaw.__tenantOriginalUrl = originalUrl;
    nestedRaw.__tenantPathSlug = slug;
    nestedRaw.url = rewrittenUrl;
  }
}

export function createTenantRewriteUrl(): (
  req: TenantRewriteRequest,
) => string {
  return (req: TenantRewriteRequest): string => {
    const rawUrl = req.url ?? '/';
    const parsed = extractTenantPathRewrite(rawUrl);
    if (!parsed) {
      return rawUrl;
    }

    syncRequestUrls(req, rawUrl, parsed.slug, parsed.rewrittenUrl);
    return parsed.rewrittenUrl;
  };
}

function normalizeHostname(rawHost: string | undefined | null): string {
  if (!rawHost) return '';
  let host = rawHost.trim().toLowerCase();
  if (!host) return '';

  if (host.startsWith('[')) {
    const endBracket = host.indexOf(']');
    if (endBracket !== -1) {
      host = host.slice(0, endBracket + 1);
    }
    return host;
  }

  const colonIdx = host.indexOf(':');
  if (colonIdx !== -1) {
    host = host.slice(0, colonIdx);
  }
  return host.replace(/\.+$/, '');
}

function resolveRequestHostname(
  req: FastifyRequest,
  trustProxyOption?: boolean,
): string {
  if (trustProxyOption === true) {
    const forwarded = req.headers['x-forwarded-host'];
    const firstForwarded = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0]
        : undefined;

    if (firstForwarded) {
      const normalized = normalizeHostname(firstForwarded);
      if (normalized) return normalized;
    }
  }

  if (trustProxyOption !== false && typeof req.hostname === 'string') {
    const normalized = normalizeHostname(req.hostname);
    if (normalized) return normalized;
  }

  const hostHeader = Array.isArray(req.headers.host)
    ? req.headers.host[0]
    : req.headers.host;

  return normalizeHostname(hostHeader);
}

function resolveHostSlug(
  hostname: string,
  platformHostSet: ReadonlySet<string>,
  baseDomain: string,
): string | null {
  if (!hostname || platformHostSet.has(hostname)) {
    return null;
  }

  if (!baseDomain || hostname === baseDomain) {
    return null;
  }

  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const sub = hostname.slice(0, -suffix.length);
  if (!sub || sub.includes('.') || isReservedTenantSlug(sub)) {
    return null;
  }

  return sub;
}

function buildPlatformContext(): ResolvedTenantContext {
  return {
    tenantId: null,
    slug: null,
    tierId: null,
    configVersion: 0,
    source: 'platform',
  };
}

function attachTenantContext(
  req: FastifyRequest,
  ctx: ResolvedTenantContext,
): void {
  (
    req as FastifyRequest & { tenantContext?: ResolvedTenantContext }
  ).tenantContext = ctx;
}

function sendErrorResponse(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  error: string,
  message: string,
): void {
  void reply.code(statusCode).send({
    statusCode,
    code,
    error,
    message,
  });
}

interface FastifyAdapterHookHost {
  setOnRequestHook?: (hook: FastifyOnRequestCallback) => void;
  onRequestHook?: FastifyOnRequestCallback;
  getInstance?: () => FastifyInstance;
}

export function registerTenantResolverHook(
  app: NestFastifyApplication,
  tenantLookup: (slug: string) => Promise<TenantSummaryCache | null>,
  platformHosts: string[],
  options?: TenantResolverHookOptions,
): void {
  const platformHostSet = new Set(
    platformHosts.map((host) => normalizeHostname(host)).filter(Boolean),
  );
  const baseDomain = normalizeHostname(
    options?.tenantBaseDomain ?? env.TENANT_BASE_DOMAIN,
  );

  const adapter = app.getHttpAdapter() as unknown as FastifyAdapterHookHost;
  const trustProxy = options?.trustProxy;

  const previousOnRequestHook =
    typeof adapter?.setOnRequestHook === 'function'
      ? adapter.onRequestHook
      : undefined;

  const runNext = (
    req: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void,
    ctx: ResolvedTenantContext,
  ): void => {
    attachTenantContext(req, ctx);
    TenantContextStorage.run(ctx, () => {
      if (previousOnRequestHook) {
        previousOnRequestHook(req, reply, done);
        return;
      }
      done();
    });
  };

  // Must remain callback-style (never async) so AsyncLocalStorage stays active
  // through @fastify/middie Better Auth middleware and NestJS controllers.
  const onRequestHook: FastifyOnRequestCallback = (req, reply, done) => {
    const rawReq = req.raw as TenantRewriteRequest;

    if (!rawReq.__tenantPathSlug && rawReq.url) {
      const fallbackRewrite = extractTenantPathRewrite(rawReq.url);
      if (fallbackRewrite) {
        syncRequestUrls(
          rawReq,
          rawReq.url,
          fallbackRewrite.slug,
          fallbackRewrite.rewrittenUrl,
        );
      }
    }

    const pathSlug = rawReq.__tenantPathSlug ?? null;
    const hostname = resolveRequestHostname(req, trustProxy);
    const hostSlug = resolveHostSlug(hostname, platformHostSet, baseDomain);

    if (hostSlug && pathSlug && hostSlug !== pathSlug) {
      sendErrorResponse(
        reply,
        400,
        'TENANT_MISMATCH',
        'Bad Request',
        `Host tenant '${hostSlug}' tidak cocok dengan path tenant '${pathSlug}'.`,
      );
      return;
    }

    const effectiveSlug = hostSlug ?? pathSlug;
    if (!effectiveSlug) {
      runNext(req, reply, done, buildPlatformContext());
      return;
    }

    if (isReservedTenantSlug(effectiveSlug)) {
      sendErrorResponse(
        reply,
        404,
        'TENANT_NOT_FOUND',
        'Not Found',
        `Tenant '${effectiveSlug}' tidak ditemukan.`,
      );
      return;
    }

    void tenantLookup(effectiveSlug).then(
      (summary) => {
        if (!summary) {
          sendErrorResponse(
            reply,
            404,
            'TENANT_NOT_FOUND',
            'Not Found',
            `Tenant '${effectiveSlug}' tidak ditemukan.`,
          );
          return;
        }

        if (summary.status !== 'active') {
          sendErrorResponse(
            reply,
            403,
            'TENANT_SUSPENDED',
            'Forbidden',
            `Tenant '${summary.slug}' sedang ditangguhkan.`,
          );
          return;
        }

        const resolvedCtx: ResolvedTenantContext = {
          tenantId: summary.id,
          slug: summary.slug,
          tierId: summary.tierId,
          configVersion: summary.configVersion,
          source: hostSlug ? 'subdomain' : 'path',
        };
        runNext(req, reply, done, resolvedCtx);
      },
      (err: unknown) => {
        done(err instanceof Error ? err : new Error(String(err)));
      },
    );
  };

  // Prefer FastifyAdapter.setOnRequestHook so tenant ALS binds BEFORE
  // @fastify/middie executes @thallesp/nestjs-better-auth authHandler.
  if (typeof adapter?.setOnRequestHook === 'function') {
    adapter.setOnRequestHook(onRequestHook);
    return;
  }

  const fastify = adapter?.getInstance?.();
  if (fastify) {
    fastify.addHook('onRequest', onRequestHook);
  }
}
