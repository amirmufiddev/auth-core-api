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
  createSignedState,
  getCentralCallbackBaseUrl,
  validateReturnTo,
  verifySignedState,
  type SignedSocialStatePayload,
} from './social-bridge-state.helper';
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
export type { SignedSocialStatePayload } from './social-bridge-state.helper';

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

  createSignedState(input: {
    tenantId: string;
    tenantSlug: string;
    mode: 'subdomain' | 'path';
    provider: string;
    returnTo?: string;
  }): string {
    return createSignedState(this.configService, input);
  }

  verifySignedState(
    state: string,
    expectedProvider: string,
  ): SignedSocialStatePayload {
    return verifySignedState(this.configService, state, expectedProvider);
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
    const redirectUri = `${getCentralCallbackBaseUrl(this.configService)}/api/social-bridge/callback/${providerKey}`;
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

    const redirectUri = `${getCentralCallbackBaseUrl(this.configService)}/api/social-bridge/callback/${providerKey}`;
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
      redirectTo: validateReturnTo(payload.returnTo),
    };
  }
}
