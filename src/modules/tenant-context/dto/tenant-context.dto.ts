export interface PosSessionContextDto {
  userId: string;
  tenantId: string;
  activeOrganizationId: string | null;
  orgRole: string | null;
  orgPermissions: string[];
}

export interface TenantAuthRequestContext {
  authType: 'bearer' | 'api_key';
  tenantId: string;
  userId: string;
  activeOrganizationId: string | null;
  apiKeyId?: string;
}

export interface TenantContextRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, string | undefined>;
  tenantAuthContext?: TenantAuthRequestContext;
}

export interface ListTenantOrganizationsQueryDto {
  page?: number;
  limit?: number;
  search?: string;
}

export interface ListOrganizationMembersQueryDto {
  page?: number;
  limit?: number;
  search?: string;
}
