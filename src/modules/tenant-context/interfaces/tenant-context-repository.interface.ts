export const TENANT_CONTEXT_REPOSITORY_TOKEN = Symbol(
  'TENANT_CONTEXT_REPOSITORY_TOKEN',
);

export interface TenantOrganizationSummary {
  id: string;
  tenantId: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: Date;
}

export interface TenantOrganizationMemberSummary {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  userName: string | null;
  userEmail: string | null;
}

export interface TenantApiKeyRecord {
  id: string;
  tenantId: string | null;
  referenceId: string;
  key: string;
  enabled: boolean | null;
  expiresAt: Date | null;
}

export interface ITenantContextRepository {
  findTenantStatus(tenantId: string): Promise<'active' | 'suspended' | null>;
  findUserTenantId(
    userId: string,
  ): Promise<{ tenantId: string | null; banned?: boolean | null } | null>;
  findOrganizationById(
    organizationId: string,
  ): Promise<TenantOrganizationSummary | null>;
  findMemberInOrganization(
    organizationId: string,
    userId: string,
  ): Promise<{ role: string; tenantId: string | null } | null>;
  findOrganizationRolePermissions(
    organizationId: string,
    role: string,
  ): Promise<string | null>;
  findApiKeyByHashedKey(hashedKey: string): Promise<TenantApiKeyRecord | null>;
  listOrganizationsForTenant(params: {
    tenantId: string;
    userId?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: TenantOrganizationSummary[]; total: number }>;
  listOrganizationMembers(params: {
    organizationId: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: TenantOrganizationMemberSummary[]; total: number }>;
}
