import type { ApiKey } from '@/database/schema';

export const PORTAL_TENANT_API_KEY_REPOSITORY_TOKEN = Symbol(
  'PORTAL_TENANT_API_KEY_REPOSITORY',
);

export interface ListPortalTenantApiKeysQuery {
  tenantId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface PortalTenantApiKeyWithOwnerRow {
  apiKey: ApiKey;
  ownerEmail: string | null;
}

export interface IPortalTenantApiKeyRepository {
  listByTenantPaginated(
    query: ListPortalTenantApiKeysQuery,
  ): Promise<{ items: PortalTenantApiKeyWithOwnerRow[]; total: number }>;
  findByTenantAndId(tenantId: string, id: string): Promise<ApiKey | null>;
  deleteByTenantAndId(tenantId: string, id: string): Promise<boolean>;
}