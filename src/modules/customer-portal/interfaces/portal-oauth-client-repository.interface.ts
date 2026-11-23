import type * as schema from '@/database/schema';

export type PortalOAuthClientRow = typeof schema.oauthClient.$inferSelect;
export type PortalOAuthClientType =
  'oidc-confidential' | 'oidc-public' | 'mcp-client';

export interface ListTenantOAuthClientsQuery {
  tenantId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface CreatePortalOAuthClientRecord {
  id: string;
  tenantId: string;
  clientId: string;
  clientSecret: string | null;
  name: string;
  redirectUris: string[];
  scopes: string[];
  requirePKCE: boolean;
  tokenEndpointAuthMethod: string;
  applicationType: string;
  userId: string;
  metadata: Record<string, unknown>;
}

export const PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN = Symbol(
  'PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN',
);

export interface IPortalOAuthClientRepository {
  listByTenantPaginated(
    query: ListTenantOAuthClientsQuery,
  ): Promise<{ items: PortalOAuthClientRow[]; total: number }>;
  countByTenant(tenantId: string): Promise<number>;
  create(input: CreatePortalOAuthClientRecord): Promise<PortalOAuthClientRow>;
  deleteByTenantAndId(tenantId: string, id: string): Promise<boolean>;
}
