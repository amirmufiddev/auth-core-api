import * as crypto from 'node:crypto';
import { describe, expect, it, mock } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  IPlatformApiKeyRepository,
  IPlatformOAuthClientRepository,
  IPlatformSsoProviderRepository,
  IPlatformUserRepository,
} from '../interfaces';
import { PlatformApiKeysService } from './platform-api-keys.service';
import { PlatformOAuthSsoService } from './platform-oauth-sso.service';
import { PlatformRolesService } from './platform-roles.service';

describe('PlatformApiKeysService & PlatformOAuthSsoService & PlatformRolesService', () => {
  const actor = {
    id: 'usr_1',
    email: 'admin@authcore.io',
    role: 'super_admin',
  };

  it('should enforce feature flag gating in PlatformApiKeysService.listApiKeys', async () => {
    const apiKeyRepo = {
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
    } as unknown as IPlatformApiKeyRepository;
    const userRepo = {} as IPlatformUserRepository;
    const authService = { api: {} } as any;
    const featureConfig = {
      assertFeatureEnabled: mock(() => {
        throw new ForbiddenException('FEATURE_DISABLED');
      }),
    } as any;
    const auditService = {
      recordAudit: mock(() => Promise.resolve(undefined)),
    } as any;

    const service = new PlatformApiKeysService(
      apiKeyRepo,
      userRepo,
      authService,
      featureConfig,
      auditService,
    );

    await expect(
      service.listApiKeys({ page: 0, pageSize: 10 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should delegate API key creation to authService.api.createApiKey (@better-auth/api-key)', async () => {
    const apiKeyRepo = {} as IPlatformApiKeyRepository;
    const userRepo = {
      findPlatformByEmail: mock(() =>
        Promise.resolve({
          id: 'usr_owner',
          email: 'owner@authcore.io',
        }),
      ),
    } as unknown as IPlatformUserRepository;
    const createApiKeyMock = mock(() =>
      Promise.resolve({
        id: 'key_1',
        name: 'CI Key',
        prefix: 'ak_',
        start: 'ak_1234',
        key: 'ak_1234secretvalue',
        rateLimitMax: 200,
        rateLimitTimeWindow: 60000,
        enabled: true,
        requestCount: 0,
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const authService = { api: { createApiKey: createApiKeyMock } } as any;
    const featureConfig = {
      assertFeatureEnabled: mock(() => undefined),
    } as any;
    const auditService = {
      recordAudit: mock(() => Promise.resolve(undefined)),
    } as any;

    const service = new PlatformApiKeysService(
      apiKeyRepo,
      userRepo,
      authService,
      featureConfig,
      auditService,
    );

    const res = await service.createApiKey(
      {
        name: 'CI Key',
        prefix: 'ak_',
        ownerEmail: 'owner@authcore.io',
        scopes: ['user:read', 'role:create'],
        rateLimitMax: 200,
      },
      actor,
    );

    expect(createApiKeyMock).toHaveBeenCalledTimes(1);
    expect(createApiKeyMock).toHaveBeenCalledWith({
      body: {
        name: 'CI Key',
        prefix: 'ak_',
        userId: 'usr_owner',
        permissions: { user: ['read'], role: ['create'] },
        rateLimitEnabled: true,
        rateLimitMax: 200,
        rateLimitTimeWindow: 60000,
      },
    });
    expect(res.plainSecret).toBe('ak_1234secretvalue');
    expect(res.record.ownerEmail).toBe('owner@authcore.io');
    expect(auditService.recordAudit).toHaveBeenCalledTimes(1);
  });

  it('should throw NotFoundException when deleting a missing API key', async () => {
    const apiKeyRepo = {
      findById: mock(() => Promise.resolve(null)),
      deleteById: mock(() => Promise.resolve(undefined)),
    } as unknown as IPlatformApiKeyRepository;
    const service = new PlatformApiKeysService(
      apiKeyRepo,
      {} as IPlatformUserRepository,
      { api: {} } as any,
      { assertFeatureEnabled: mock(() => undefined) } as any,
      { recordAudit: mock(() => Promise.resolve(undefined)) } as any,
    );

    await expect(service.deleteApiKey('missing_key', actor)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should hash OAuth clientSecret with sha256 base64url for confidential clients and store null for public clients', async () => {
    const createdRecords: Array<Record<string, unknown>> = [];
    const oauthRepo: IPlatformOAuthClientRepository = {
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      create: mock((input) => {
        createdRecords.push(input as unknown as Record<string, unknown>);
        return Promise.resolve({
          ...input,
          clientDiscoveryId: null,
          disabled: false,
          skipConsent: false,
          enableEndSession: false,
          subjectType: null,
          clientCredentialsScopes: null,
          tenantId: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          uri: null,
          icon: null,
          contacts: null,
          tos: null,
          policy: null,
          softwareId: null,
          softwareVersion: null,
          softwareStatement: null,
          postLogoutRedirectUris: null,
          backchannelLogoutUri: null,
          backchannelLogoutSessionRequired: null,
          jwks: null,
          jwksUri: null,
          grantTypes: null,
          responseTypes: null,
          dpopBoundAccessTokens: null,
          referenceId: null,
        } as any);
      }),
      deleteById: mock(() => Promise.resolve(undefined)),
    };
    const ssoRepo = {} as IPlatformSsoProviderRepository;
    const featureConfig = {
      assertFeatureEnabled: mock(() => undefined),
    } as any;

    const service = new PlatformOAuthSsoService(
      oauthRepo,
      ssoRepo,
      featureConfig,
    );

    const confidential = await service.createOAuthClient(
      {
        name: 'Partner Portal',
        type: 'oidc-confidential',
        redirectUris: ['https://partner.example.com/callback'],
        scopes: ['openid', 'profile'],
        pkceRequired: true,
      },
      actor,
    );

    expect(confidential.plainClientSecret).toBeDefined();
    const expectedHash = crypto
      .createHash('sha256')
      .update(confidential.plainClientSecret!)
      .digest('base64url');
    expect(createdRecords[0].clientSecret).toBe(expectedHash);

    const pub = await service.createOAuthClient(
      {
        name: 'Mobile App',
        type: 'oidc-public',
        redirectUris: ['myapp://callback'],
        scopes: ['openid'],
        pkceRequired: true,
      },
      actor,
    );
    expect(createdRecords[1].clientSecret).toBeNull();
    expect(pub.plainClientSecret).toBeUndefined();
  });

  it('should block deleting system roles in PlatformRolesService', async () => {
    const roleRepo = {
      findById: mock(() =>
        Promise.resolve({
          id: 'role_super_admin',
          slug: 'super_admin',
          isSystem: true,
        }),
      ),
    } as any;

    const service = new PlatformRolesService(
      roleRepo,
      {} as IPlatformUserRepository,
      { assertFeatureEnabled: mock(() => undefined) } as any,
      { recordAudit: mock(() => Promise.resolve(undefined)) } as any,
    );

    await expect(service.deleteRole('role_super_admin', actor)).rejects.toThrow(
      BadRequestException,
    );
  });
});
