import type * as schema from '@/database/schema';

export type PortalTenantUserRow = typeof schema.user.$inferSelect;

export interface ListTenantUsersQuery {
  tenantId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export const PORTAL_TENANT_USER_REPOSITORY_TOKEN = Symbol(
  'PORTAL_TENANT_USER_REPOSITORY_TOKEN',
);

export interface IPortalTenantUserRepository {
  listByTenantPaginated(
    query: ListTenantUsersQuery,
  ): Promise<{ items: PortalTenantUserRow[]; total: number }>;
}
