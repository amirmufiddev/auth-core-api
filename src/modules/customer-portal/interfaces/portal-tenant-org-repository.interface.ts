import type * as schema from '@/database/schema';

export type PortalTenantOrgRow = typeof schema.organization.$inferSelect;

export interface ListTenantOrgsQuery {
  tenantId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export const PORTAL_TENANT_ORG_REPOSITORY_TOKEN = Symbol(
  'PORTAL_TENANT_ORG_REPOSITORY_TOKEN',
);

export interface IPortalTenantOrgRepository {
  listByTenantPaginated(
    query: ListTenantOrgsQuery,
  ): Promise<{ items: PortalTenantOrgRow[]; total: number }>;
}
