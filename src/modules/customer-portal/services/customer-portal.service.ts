import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { BusinessError } from '@/common/errors/business-error';
import type {
  TenantBillingRecordStatus,
  TenantBillingStatus,
  TenantStatus,
} from '@/database/schema';
import { BillingService, type BillingRecordRow } from '@/modules/billing';
import { TenantService, type TenantRow } from '@/modules/tenant';
import {
  PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
  type IPortalOAuthClientRepository,
  type PortalOAuthClientRow,
  type PortalOAuthClientType,
} from '../interfaces/portal-oauth-client-repository.interface';

const DEFAULT_TIER_ID = 'tier_free';
const FREE_TIER_MAX_OAUTH_CLIENTS = 1;

export interface PortalOAuthClientItem {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  type: PortalOAuthClientType;
  redirectUris: string[];
  scopes: string[];
  pkceRequired: boolean;
  active: boolean;
  createdAt: string;
  plainClientSecret?: string;
}

@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly billingService: BillingService,
    @Inject(PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN)
    private readonly oauthRepo: IPortalOAuthClientRepository,
  ) {}

  private mapOAuthClient(
    row: PortalOAuthClientRow,
    plainClientSecret?: string,
  ): PortalOAuthClientItem {
    const meta = (row.metadata ?? {}) as {
      clientType?: PortalOAuthClientType;
    };
    const type: PortalOAuthClientType =
      meta.clientType ??
      (row.tokenEndpointAuthMethod === 'none'
        ? 'oidc-public'
        : 'oidc-confidential');

    return {
      id: row.id,
      tenantId: row.tenantId ?? '',
      clientId: row.clientId,
      name: row.name ?? row.clientId,
      type,
      redirectUris: row.redirectUris ?? [],
      scopes: row.scopes ?? ['openid', 'profile', 'email'],
      pkceRequired: Boolean(row.requirePKCE ?? true),
      active: !Boolean(row.disabled),
      createdAt: (row.createdAt ?? new Date()).toISOString(),
      ...(plainClientSecret ? { plainClientSecret } : {}),
    };
  }

  async listOwnedTenants(
    ownerUserId: string,
    query: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: TenantStatus;
    },
  ): Promise<{
    items: TenantRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const paging = clampZeroBasedPagination(
      query.page ?? 0,
      query.pageSize ?? 10,
    );

    return this.tenantService.listTenants({
      page: paging.page,
      pageSize: paging.pageSize,
      search: query.search,
      status: query.status,
      ownerUserId,
    });
  }

  async createTenant(
    ownerUserId: string,
    input: { name: string; slug: string },
  ): Promise<TenantRow> {
    return this.tenantService.createTenant({
      name: input.name,
      slug: input.slug,
      ownerUserId,
      tierId: DEFAULT_TIER_ID,
    });
  }

  async getTenant(tenantId: string): Promise<TenantRow> {
    return this.tenantService.getTenantById(tenantId);
  }

  async updateTenant(
    tenantId: string,
    input: { name?: string; slug?: string },
  ): Promise<TenantRow> {
    return this.tenantService.updateTenant(tenantId, {
      name: input.name,
      slug: input.slug,
    });
  }

  async listTenantOAuthClients(
    tenantId: string,
    query: { page?: number; pageSize?: number; search?: string },
  ): Promise<{
    items: PortalOAuthClientItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const paging = clampZeroBasedPagination(
      query.page ?? 0,
      query.pageSize ?? 10,
    );

    const { items, total } = await this.oauthRepo.listByTenantPaginated({
      tenantId,
      page: paging.page,
      pageSize: paging.pageSize,
      search: query.search,
    });

    return {
      items: items.map((row) => this.mapOAuthClient(row)),
      total,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async createTenantOAuthClient(
    tenantId: string,
    actorId: string,
    input: {
      name: string;
      type: PortalOAuthClientType;
      redirectUris: string[];
      scopes: string[];
      pkceRequired: boolean;
    },
  ): Promise<PortalOAuthClientItem> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    const maxClients =
      tenant.tierId === DEFAULT_TIER_ID
        ? FREE_TIER_MAX_OAUTH_CLIENTS
        : undefined;

    const normalizedScopes = Array.from(
      new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean)),
    );
    const normalizedRedirectUris = input.redirectUris
      .map((uri) => uri.trim())
      .filter(Boolean);

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

    const created = await this.oauthRepo.createWithQuotaCheck(
      {
        id: `oa_${crypto.randomUUID()}`,
        tenantId,
        clientId,
        clientSecret: hashedClientSecret,
        name: input.name.trim(),
        redirectUris: normalizedRedirectUris,
        scopes: normalizedScopes,
        requirePKCE: input.pkceRequired,
        tokenEndpointAuthMethod:
          input.type === 'oidc-public' ? 'none' : 'client_secret_basic',
        applicationType: input.type === 'oidc-public' ? 'native' : 'web',
        userId: actorId,
        metadata: { clientType: input.type },
      },
      maxClients,
    );

    return this.mapOAuthClient(created, plainClientSecret ?? undefined);
  }

  async deleteTenantOAuthClient(
    tenantId: string,
    clientId: string,
  ): Promise<void> {
    const deleted = await this.oauthRepo.deleteByTenantAndId(
      tenantId,
      clientId,
    );
    if (!deleted) {
      throw BusinessError.notFound('OAuthClient', clientId);
    }
  }

  async getTenantBilling(
    tenantId: string,
    query: {
      page?: number;
      pageSize?: number;
      status?: TenantBillingRecordStatus;
    },
  ): Promise<{
    tenantId: string;
    tierId: string;
    billingStatus: TenantBillingStatus;
    items: BillingRecordRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    const paging = clampZeroBasedPagination(
      query.page ?? 0,
      query.pageSize ?? 10,
    );

    const records = await this.billingService.listRecords({
      tenantId,
      page: paging.page,
      pageSize: paging.pageSize,
      status: query.status,
    });

    return {
      tenantId: tenant.id,
      tierId: tenant.tierId,
      billingStatus: tenant.billingStatus,
      items: records.items,
      total: records.total,
      page: records.page,
      pageSize: records.pageSize,
    };
  }
}
