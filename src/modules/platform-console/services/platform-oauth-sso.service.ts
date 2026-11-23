import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthFeatureConfigService } from '@/modules/auth';
import type {
  CreateOAuthClientDto,
  CreateSsoProviderDto,
} from '../dto/platform-console.dto';
import {
  type ConsoleActor,
  type IPlatformOAuthClientRepository,
  type IPlatformSsoProviderRepository,
  type PaginatedSearchQuery,
  PLATFORM_OAUTH_CLIENT_REPOSITORY_TOKEN,
  PLATFORM_SSO_PROVIDER_REPOSITORY_TOKEN,
} from '../interfaces';

@Injectable()
export class PlatformOAuthSsoService {
  constructor(
    @Inject(PLATFORM_OAUTH_CLIENT_REPOSITORY_TOKEN)
    private readonly oauthRepo: IPlatformOAuthClientRepository,
    @Inject(PLATFORM_SSO_PROVIDER_REPOSITORY_TOKEN)
    private readonly ssoRepo: IPlatformSsoProviderRepository,
    private readonly featureConfigService: AuthFeatureConfigService,
  ) {}

  async listOAuthClients(query: PaginatedSearchQuery) {
    this.featureConfigService.assertFeatureEnabled('oauthProvider');

    const { items: rows, total } = await this.oauthRepo.listPaginated(query);

    return {
      items: rows.map((c) => {
        const meta = (c.metadata ?? {}) as {
          clientType?: 'oidc-confidential' | 'oidc-public' | 'mcp-client';
        };
        const type: 'oidc-confidential' | 'oidc-public' | 'mcp-client' =
          meta.clientType ??
          (c.tokenEndpointAuthMethod === 'none'
            ? 'oidc-public'
            : 'oidc-confidential');
        return {
          id: c.id,
          clientId: c.clientId,
          name: c.name ?? c.clientId,
          type,
          redirectUris: c.redirectUris ?? [],
          scopes: c.scopes ?? ['openid', 'profile', 'email'],
          pkceRequired: Boolean(c.requirePKCE ?? true),
          active: !Boolean(c.disabled),
          createdAt: (c.createdAt ?? new Date()).toISOString(),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createOAuthClient(input: CreateOAuthClientDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('oauthProvider');

    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const clientId = `${slug || 'client'}_${crypto.randomBytes(4).toString('hex')}`;
    const plainClientSecret =
      input.type === 'oidc-public'
        ? null
        : `ocs_${crypto.randomBytes(24).toString('hex')}`;
    const hashedClientSecret = plainClientSecret
      ? crypto
          .createHash('sha256')
          .update(plainClientSecret)
          .digest('base64url')
      : null;

    const created = await this.oauthRepo.create({
      id: `oa_${crypto.randomUUID()}`,
      clientId,
      clientSecret: hashedClientSecret,
      name: input.name,
      redirectUris: input.redirectUris,
      scopes: input.scopes,
      requirePKCE: input.pkceRequired,
      tokenEndpointAuthMethod:
        input.type === 'oidc-public' ? 'none' : 'client_secret_basic',
      applicationType: input.type === 'oidc-public' ? 'native' : 'web',
      userId: actor.id,
      metadata: { clientType: input.type },
    });

    return {
      id: created.id,
      clientId: created.clientId,
      name: created.name ?? input.name,
      type: input.type,
      redirectUris: created.redirectUris ?? [],
      scopes: created.scopes ?? input.scopes,
      pkceRequired: Boolean(created.requirePKCE),
      active: !Boolean(created.disabled),
      createdAt: (created.createdAt ?? new Date()).toISOString(),
      ...(plainClientSecret ? { plainClientSecret } : {}),
    };
  }

  async deleteOAuthClient(id: string): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('oauthProvider');
    await this.oauthRepo.deleteById(id);
  }

  async listSsoProviders() {
    this.featureConfigService.assertFeatureEnabled('sso');

    const rows = await this.ssoRepo.listAllWithOrgNames();

    return rows.map(({ provider: p, organizationName }) => {
      const protocol: 'saml2' | 'oidc' = p.samlConfig ? 'saml2' : 'oidc';
      let name = p.providerId;
      let scimEnabled = false;

      try {
        const raw = p.samlConfig || p.oidcConfig;
        if (raw) {
          const parsed = JSON.parse(raw) as {
            displayName?: string;
            scimEnabled?: boolean;
          };
          if (parsed.displayName) name = parsed.displayName;
          scimEnabled = Boolean(parsed.scimEnabled);
        }
      } catch {
        // ignore metadata parse failure
      }

      return {
        id: p.id,
        providerId: p.providerId,
        name,
        protocol,
        domain: p.domain,
        domainVerified: Boolean(p.domainVerified),
        organizationName: organizationName ?? 'Auth Core HQ',
        scimEnabled,
        scimGroupMappings: [
          { idpGroup: 'Administrators', appRole: 'org_manager' },
        ],
        createdAt: (p.createdAt ?? new Date()).toISOString(),
      };
    });
  }

  async createSsoProvider(input: CreateSsoProviderDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('sso');

    const providerId = `${input.protocol}-${input.domain.replace(/\./g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
    const configPayload = JSON.stringify({
      displayName: input.name,
      scimEnabled: input.scimEnabled,
    });

    const created = await this.ssoRepo.create({
      id: `sso_${crypto.randomUUID()}`,
      providerId,
      issuer: `https://${input.domain}`,
      domain: input.domain,
      userId: actor.id,
      samlConfig: input.protocol === 'saml2' ? configPayload : null,
      oidcConfig: input.protocol === 'oidc' ? configPayload : null,
    });

    return {
      id: created.id,
      providerId: created.providerId,
      name: input.name,
      protocol: input.protocol,
      domain: created.domain,
      domainVerified: Boolean(created.domainVerified),
      organizationName: input.organizationName,
      scimEnabled: input.scimEnabled,
      scimGroupMappings: [
        { idpGroup: 'Administrators', appRole: 'org_manager' },
      ],
      createdAt: (created.createdAt ?? new Date()).toISOString(),
    };
  }

  async deleteSsoProvider(id: string): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('sso');
    await this.ssoRepo.deleteById(id);
  }
}
