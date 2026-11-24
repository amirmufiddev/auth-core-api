import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import {
  SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
  SOCIAL_PROVIDER_ENDPOINTS,
  type ISocialBridgeOAuthClient,
} from './social-bridge.oauth-client';
import {
  SOCIAL_BRIDGE_REPOSITORY_TOKEN,
  type ISocialBridgeRepository,
} from './social-bridge.repository';

export {
  SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
  type ISocialBridgeOAuthClient,
} from './social-bridge.oauth-client';
export {
  SOCIAL_BRIDGE_REPOSITORY_TOKEN,
  type ISocialBridgeRepository,
} from './social-bridge.repository';

export interface SocialExchangePayload {
  tenantId: string;
  tenantSlug: string;
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  returnTo: string;
}

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

export interface SocialBridgeRedisClient {
  set(
    key: string,
    value: string,
    exFlag: 'EX',
    ttlSeconds: number,
  ): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

const EXCHANGE_CODE_TTL_SECONDS = 45;
const STATE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXCHANGE_REDIS_PREFIX = 'authcore:social-bridge:code:';

@Injectable()
export class SocialBridgeService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(BETTER_AUTH_REDIS_CLIENT)
    private readonly redisClient: SocialBridgeRedisClient,
    @Inject(SOCIAL_BRIDGE_REPOSITORY_TOKEN)
    private readonly repository: ISocialBridgeRepository,
    @Inject(SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN)
    private readonly oauthClient: ISocialBridgeOAuthClient,
  ) {}

  private getSigningSecret(): string {
    return (
      this.configService.get<string>('BETTER_AUTH_SECRET') ??
      process.env.BETTER_AUTH_SECRET ??
      ''
    );
  }

  private getBaseUrl(): URL {
    const raw =
      this.configService.get<string>('BETTER_AUTH_URL') ??
      process.env.BETTER_AUTH_URL ??
      'http://localhost:2001';
    return new URL(raw);
  }

  private getCentralCallbackBaseUrl(): string {
    const configured =
      this.configService.get<string>('SOCIAL_CALLBACK_BASE_URL') ??
      process.env.SOCIAL_CALLBACK_BASE_URL;
    if (configured && configured.trim() !== '') {
      return configured.replace(/\/+$/, '');
    }
    return this.getBaseUrl().origin;
  }

  private buildServerReturnOrigin(
    tenantSlug: string,
    mode: 'subdomain' | 'path',
  ): string {
    const baseUrl = this.getBaseUrl();
    if (mode === 'path') {
      return baseUrl.origin;
    }
    const baseDomain = (
      this.configService.get<string>('TENANT_BASE_DOMAIN') ??
      process.env.TENANT_BASE_DOMAIN ??
      'authcore.local'
    )
      .trim()
      .toLowerCase();
    const portSuffix = baseUrl.port ? `:${baseUrl.port}` : '';
    return `${baseUrl.protocol}//${tenantSlug}.${baseDomain}${portSuffix}`;
  }

  private validateReturnTo(returnTo?: string): string {
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

  createSignedState(input: {
    tenantId: string;
    tenantSlug: string;
    mode: 'subdomain' | 'path';
    provider: string;
    returnTo?: string;
  }): string {
    const safeReturnTo = this.validateReturnTo(input.returnTo);
    const returnOrigin = this.buildServerReturnOrigin(
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
      .createHmac('sha256', this.getSigningSecret())
      .update(encoded)
      .digest('base64url');

    return `${encoded}.${sig}`;
  }

  verifySignedState(
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
      .createHmac('sha256', this.getSigningSecret())
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

  async buildAuthorizeRedirectUrl(input: {
    tenantId: string;
    tenantSlug: string;
    mode: 'subdomain' | 'path';
    provider: string;
    returnTo?: string;
  }): Promise<string> {
    const providerKey = input.provider.toLowerCase();
    const endpoints = SOCIAL_PROVIDER_ENDPOINTS[providerKey];
    if (!endpoints) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UNSUPPORTED_SOCIAL_PROVIDER',
        message: `Provider '${input.provider}' tidak didukung.`,
      });
    }

    const credentials = await this.repository.findTenantCredentials(
      input.tenantId,
      providerKey,
    );
    if (!credentials) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SOCIAL_PROVIDER_NOT_CONFIGURED',
        message: `Provider '${input.provider}' belum dikonfigurasi untuk tenant ini.`,
      });
    }

    const state = this.createSignedState(input);
    const redirectUri = `${this.getCentralCallbackBaseUrl()}/api/social-bridge/callback/${providerKey}`;
    const url = new URL(endpoints.authorizeUrl);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', endpoints.defaultScope);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async handleCentralCallback(input: {
    provider: string;
    code: string;
    state: string;
  }): Promise<{ redirectUrl: string }> {
    const providerKey = input.provider.toLowerCase();
    const statePayload = this.verifySignedState(input.state, providerKey);

    const credentials = await this.repository.findTenantCredentials(
      statePayload.tenantId,
      providerKey,
    );
    if (!credentials) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'SOCIAL_PROVIDER_NOT_CONFIGURED',
        message: `Kredensial '${providerKey}' untuk tenant tidak ditemukan.`,
      });
    }

    const redirectUri = `${this.getCentralCallbackBaseUrl()}/api/social-bridge/callback/${providerKey}`;
    const profile = await this.oauthClient.exchangeCodeForProfile({
      provider: providerKey,
      code: input.code,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      redirectUri,
    });

    const oneTimeCode = crypto.randomBytes(32).toString('hex');
    const exchangePayload: SocialExchangePayload = {
      tenantId: statePayload.tenantId,
      tenantSlug: statePayload.tenantSlug,
      provider: providerKey,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      name: profile.name,
      emailVerified: profile.emailVerified,
      returnTo: statePayload.returnTo,
    };

    await this.redisClient.set(
      `${EXCHANGE_REDIS_PREFIX}${oneTimeCode}`,
      JSON.stringify(exchangePayload),
      'EX',
      EXCHANGE_CODE_TTL_SECONDS,
    );

    const exchangePath =
      statePayload.mode === 'path'
        ? `/t/${statePayload.tenantSlug}/api/social-bridge/exchange`
        : '/api/social-bridge/exchange';

    const redirectUrl = `${statePayload.returnOrigin}${exchangePath}?code=${encodeURIComponent(oneTimeCode)}`;
    return { redirectUrl };
  }

  async exchangeOnTenantHost(
    oneTimeCode: string,
    currentTenantId: string,
  ): Promise<{ sessionToken: string; redirectTo: string }> {
    if (!oneTimeCode) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_EXCHANGE_CODE',
        message: 'Exchange code tidak ditemukan.',
      });
    }

    const raw = await this.redisClient.getdel(
      `${EXCHANGE_REDIS_PREFIX}${oneTimeCode}`,
    );
    if (!raw) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_EXCHANGE_CODE',
        message: 'Exchange code tidak valid atau sudah digunakan.',
      });
    }

    const payload = JSON.parse(raw) as SocialExchangePayload;
    if (!currentTenantId || currentTenantId !== payload.tenantId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TENANT_MISMATCH',
        message: 'Exchange code tidak cocok dengan tenant pada host ini.',
      });
    }

    const existingAccount = await this.repository.findAccountByProvider(
      payload.tenantId,
      payload.provider,
      payload.providerAccountId,
    );

    let userId: string;
    if (existingAccount) {
      userId = existingAccount.userId;
    } else {
      const existingUser = await this.repository.findUserByTenantEmail(
        payload.tenantId,
        payload.email,
      );
      if (existingUser) {
        if (!payload.emailVerified) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'UNVERIFIED_SOCIAL_EMAIL',
            message:
              'Auto-link ditolak karena email dari provider sosial belum terverifikasi.',
          });
        }
        await this.repository.linkAccountToUser({
          tenantId: payload.tenantId,
          userId: existingUser.id,
          provider: payload.provider,
          providerAccountId: payload.providerAccountId,
        });
        userId = existingUser.id;
      } else {
        const created = await this.repository.createUserWithAccount({
          tenantId: payload.tenantId,
          email: payload.email,
          name: payload.name,
          emailVerified: payload.emailVerified,
          provider: payload.provider,
          providerAccountId: payload.providerAccountId,
        });
        userId = created.userId;
      }
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await this.repository.createSession({
      tenantId: payload.tenantId,
      userId,
      token: sessionToken,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    return {
      sessionToken,
      redirectTo: this.validateReturnTo(payload.returnTo),
    };
  }
}
