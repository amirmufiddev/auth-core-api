import { Injectable, BadGatewayException } from '@nestjs/common';

export const SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN = Symbol(
  'SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN',
);

export interface OAuthUserProfile {
  providerAccountId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface ISocialBridgeOAuthClient {
  exchangeCodeForProfile(input: {
    provider: string;
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<OAuthUserProfile>;
}

interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  defaultScope: string;
}

export const SOCIAL_PROVIDER_ENDPOINTS: Record<string, ProviderEndpoints> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    defaultScope: 'openid email profile',
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    defaultScope: 'read:user user:email',
  },
};

@Injectable()
export class FetchSocialBridgeOAuthClient implements ISocialBridgeOAuthClient {
  async exchangeCodeForProfile(input: {
    provider: string;
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<OAuthUserProfile> {
    const endpoints = SOCIAL_PROVIDER_ENDPOINTS[input.provider.toLowerCase()];
    if (!endpoints) {
      throw new BadGatewayException({
        statusCode: 502,
        code: 'UNSUPPORTED_SOCIAL_PROVIDER',
        message: `Provider '${input.provider}' tidak didukung oleh social bridge.`,
      });
    }

    const tokenRes = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      throw new BadGatewayException({
        statusCode: 502,
        code: 'OAUTH_TOKEN_EXCHANGE_FAILED',
        message: `Gagal menukar authorization code dengan ${input.provider}.`,
      });
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new BadGatewayException({
        statusCode: 502,
        code: 'OAUTH_TOKEN_MISSING',
        message: `Access token tidak ditemukan dari ${input.provider}.`,
      });
    }

    const userRes = await fetch(endpoints.userInfoUrl, {
      headers: {
        authorization: `Bearer ${tokenJson.access_token}`,
        accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      throw new BadGatewayException({
        statusCode: 502,
        code: 'OAUTH_USERINFO_FAILED',
        message: `Gagal mengambil profil pengguna dari ${input.provider}.`,
      });
    }

    const profile = (await userRes.json()) as Record<string, unknown>;
    const providerKey = input.provider.toLowerCase();
    const providerAccountId = String(profile.sub ?? profile.id ?? '');
    let email = String(profile.email ?? '').trim().toLowerCase();
    const rawVerified = profile.email_verified ?? profile.verified;
    let emailVerified = Boolean(rawVerified);

    if (
      providerKey === 'github' &&
      (!email || typeof rawVerified !== 'boolean')
    ) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          authorization: `Bearer ${tokenJson.access_token}`,
          accept: 'application/json',
        },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email?: string;
          primary?: boolean;
          verified?: boolean;
        }>;
        const picked =
          emails.find((e) => e.primary && e.verified && e.email) ??
          emails.find((e) => e.verified && e.email);
        if (picked?.email) {
          email = picked.email.trim().toLowerCase();
          emailVerified = true;
        }
      }
    }

    const name = String(profile.name ?? profile.login ?? email);

    if (!providerAccountId || !email) {
      throw new BadGatewayException({
        statusCode: 502,
        code: 'OAUTH_PROFILE_INCOMPLETE',
        message: `Profil ${input.provider} tidak memiliki id atau email.`,
      });
    }

    return { providerAccountId, email, name, emailVerified };
  }
}
