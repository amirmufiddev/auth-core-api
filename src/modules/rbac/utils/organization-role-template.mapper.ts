import type { OrganizationRoleTemplate } from '@/database/schema';

export interface OrganizationRoleTemplateResponse {
  roleName: string;
  permission: Record<string, string[]>;
  permissionScopes: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function toOrganizationRoleTemplateResponse(
  row: OrganizationRoleTemplate,
): OrganizationRoleTemplateResponse {
  return {
    roleName: row.roleName,
    permission: parseObject(row.permission) as Record<string, string[]>,
    permissionScopes: parseObject(row.permissionScopes) as Record<
      string,
      string
    >,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
