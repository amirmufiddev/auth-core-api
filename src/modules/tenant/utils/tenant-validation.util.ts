import { BusinessError } from '@/common/errors/business-error';
import { RESERVED_TENANT_SLUGS } from '../interfaces/tenant-repository.interface';

const TENANT_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const RESERVED_SLUG_SET = new Set<string>(RESERVED_TENANT_SLUGS);

export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_SLUG_SET.has(slug);
}

export interface AllowedOriginOptions {
  explicitOrigins: readonly string[];
  tenantBaseDomain?: string;
  nodeEnv?: string;
  allowWildcardInNonProd?: boolean;
}

function normalizeOriginString(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function isAllowedTenantOrigin(
  rawOrigin: string | undefined | null,
  options: AllowedOriginOptions,
): boolean {
  if (!rawOrigin || typeof rawOrigin !== 'string') {
    return false;
  }

  const normalizedInput = normalizeOriginString(rawOrigin);
  if (!normalizedInput) {
    return false;
  }

  const isProduction = options.nodeEnv === 'production';
  const normalizedExplicit = new Set(
    options.explicitOrigins.map(normalizeOriginString).filter(Boolean),
  );

  if (
    !isProduction &&
    options.allowWildcardInNonProd &&
    normalizedExplicit.has('*')
  ) {
    return true;
  }

  if (normalizedExplicit.has(normalizedInput)) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return false;
  }

  if (parsed.origin !== normalizedInput || parsed.username || parsed.password) {
    return false;
  }

  const protocolAllowed =
    parsed.protocol === 'https:' ||
    (!isProduction && parsed.protocol === 'http:');
  if (!protocolAllowed) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const baseDomain = (options.tenantBaseDomain ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');

  const checkSlug = (slug: string): boolean =>
    Boolean(slug) &&
    !slug.includes('.') &&
    TENANT_SLUG_REGEX.test(slug) &&
    !RESERVED_SLUG_SET.has(slug);

  if (baseDomain && hostname.endsWith(`.${baseDomain}`)) {
    const slug = hostname.slice(0, -(baseDomain.length + 1));
    if (checkSlug(slug)) {
      return true;
    }
  }

  if (
    !isProduction &&
    parsed.protocol === 'http:' &&
    hostname.endsWith('.localhost')
  ) {
    const slug = hostname.slice(0, -'.localhost'.length);
    if (checkSlug(slug)) {
      return true;
    }
  }

  return false;
}

export function normalizeAndValidateTenantSlug(rawSlug: string): string {
  const slug = (rawSlug ?? '').trim().toLowerCase();

  if (RESERVED_SLUG_SET.has(slug) || !TENANT_SLUG_REGEX.test(slug)) {
    throw BusinessError.badRequest(
      `Slug tenant '${slug}' tidak valid atau termasuk reserved slug.`,
      'INVALID_TENANT_SLUG',
      { slug },
    );
  }

  return slug;
}

export function extractPgErrorDetails(err: unknown): {
  code?: string;
  constraint?: string;
} {
  if (!err || typeof err !== 'object') return {};
  const record = err as {
    code?: unknown;
    constraint?: unknown;
    cause?: { code?: unknown; constraint?: unknown };
  };
  const code =
    typeof record.code === 'string'
      ? record.code
      : typeof record.cause?.code === 'string'
        ? record.cause.code
        : undefined;
  const constraint =
    typeof record.constraint === 'string'
      ? record.constraint
      : typeof record.cause?.constraint === 'string'
        ? record.cause.constraint
        : undefined;
  return { code, constraint };
}

export function mapTenantCreatePgError(
  err: unknown,
  slug: string,
  tierId: string,
  ownerUserId: string,
): never {
  const { code, constraint } = extractPgErrorDetails(err);
  if (code === '23505') {
    throw BusinessError.conflict(
      `Slug tenant '${slug}' sudah digunakan.`,
      'TENANT_SLUG_CONFLICT',
      { slug },
    );
  }
  if (code === '23503') {
    if (constraint?.includes('tier')) {
      throw BusinessError.badRequest(
        `Tier '${tierId}' tidak ditemukan.`,
        'INVALID_TIER',
        { tierId },
      );
    }
    throw BusinessError.notFound('User', ownerUserId);
  }
  throw err;
}
