import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

export interface SignedSocialStatePayload {
  tenantId: string;
  tenantSlug: string;
  mode: 'subdomain' | 'path';
  provider: string;
  returnOrigin: string;
  returnTo: string;
  nonce: string;
  exp: number;
}

const STATE_TTL_MS = 5 * 60 * 1000;

export function getSigningSecret(configService: ConfigService): string {
  const secret =
    configService.get<string>('BETTER_AUTH_SECRET', { infer: true }) ??
    process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim() === '') {
    throw new InternalServerErrorException(
      'BETTER_AUTH_SECRET is required for social bridge state signing',
    );
  }
  return secret;
}

export function getBaseUrl(configService: ConfigService): URL {
  const raw =
    configService.get<string>('BETTER_AUTH_URL', { infer: true }) ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:2001';
  return new URL(raw);
}

export function getCentralCallbackBaseUrl(
  configService: ConfigService,
): string {
  const configured =
    configService.get<string>('SOCIAL_CALLBACK_BASE_URL', { infer: true }) ??
    process.env.SOCIAL_CALLBACK_BASE_URL;
  if (configured && configured.trim() !== '') {
    return configured.replace(/\/+$/, '');
  }
  return getBaseUrl(configService).origin;
}

export function buildServerReturnOrigin(
  configService: ConfigService,
  tenantSlug: string,
  mode: 'subdomain' | 'path',
): string {
  const baseUrl = getBaseUrl(configService);
  if (mode === 'path') {
    return baseUrl.origin;
  }
  const baseDomain = (
    configService.get<string>('TENANT_BASE_DOMAIN', { infer: true }) ??
    process.env.TENANT_BASE_DOMAIN ??
    'authcore.local'
  )
    .trim()
    .toLowerCase();
  const portSuffix = baseUrl.port ? `:${baseUrl.port}` : '';
  return `${baseUrl.protocol}//${tenantSlug}.${baseDomain}${portSuffix}`;
}

export function validateReturnTo(returnTo?: string): string {
  const candidate = returnTo === undefined || returnTo === '' ? '/' : returnTo;
  if (
    typeof candidate !== 'string' ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_RETURN_TO',
      message: 'Parameter returnTo harus berupa relative path yang aman.',
    });
  }
  return candidate;
}

export function createSignedState(
  configService: ConfigService,
  input: {
    tenantId: string;
    tenantSlug: string;
    mode: 'subdomain' | 'path';
    provider: string;
    returnTo?: string;
  },
): string {
  const safeReturnTo = validateReturnTo(input.returnTo);
  const returnOrigin = buildServerReturnOrigin(
    configService,
    input.tenantSlug,
    input.mode,
  );

  const payload: SignedSocialStatePayload = {
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    mode: input.mode,
    provider: input.provider.toLowerCase(),
    returnOrigin,
    returnTo: safeReturnTo,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  };

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const sig = crypto
    .createHmac('sha256', getSigningSecret(configService))
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${sig}`;
}

export function verifySignedState(
  configService: ConfigService,
  state: string,
  expectedProvider: string,
): SignedSocialStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'INVALID_SOCIAL_STATE',
      message: 'State OAuth tidak valid.',
    });
  }

  const [encoded, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret(configService))
    .update(encoded)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'INVALID_SOCIAL_STATE',
      message: 'Signature state OAuth tidak valid.',
    });
  }

  let parsed: SignedSocialStatePayload;
  try {
    parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as SignedSocialStatePayload;
  } catch {
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'INVALID_SOCIAL_STATE',
      message: 'Payload state OAuth rusak.',
    });
  }

  if (
    !parsed.tenantId ||
    !parsed.tenantSlug ||
    parsed.provider !== expectedProvider.toLowerCase() ||
    typeof parsed.exp !== 'number' ||
    parsed.exp < Date.now()
  ) {
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'INVALID_SOCIAL_STATE',
      message: 'State OAuth kedaluwarsa atau tidak cocok.',
    });
  }

  return parsed;
}
