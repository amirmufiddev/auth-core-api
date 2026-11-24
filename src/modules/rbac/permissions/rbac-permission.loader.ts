import { eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/database/schema';
import { buildBetterAuthStatementFromRows } from '../utils/rbac-permission.mapper';
import { BOOTSTRAP_BETTER_AUTH_STATEMENT } from '../constants/permissions.constant';

const PG_UNDEFINED_TABLE = '42P01';

function isMissingRbacTables(error: unknown): boolean {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof (error as { cause?: { code?: string } }).cause?.code === 'string'
      ? (error as { cause: { code: string } }).cause.code
      : typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof (error as { code?: string }).code === 'string'
        ? (error as { code: string }).code
        : undefined;

  return code === PG_UNDEFINED_TABLE;
}

export async function loadBetterAuthStatement(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<Record<string, readonly string[]>> {
  try {
    const rows = await db
      .select({
        resource: schema.organizationPermission.resource,
        action: schema.organizationPermission.action,
      })
      .from(schema.organizationPermission)
      .where(isNull(schema.organizationPermission.deletedAt));

    if (rows.length === 0) {
      return BOOTSTRAP_BETTER_AUTH_STATEMENT;
    }

    return buildBetterAuthStatementFromRows(rows);
  } catch (error) {
    if (isMissingRbacTables(error)) {
      console.warn(
        '[rbac] Tabel organization_permission belum ada — memakai bootstrap statement. Jalankan: bun run db:migrate',
      );
      return BOOTSTRAP_BETTER_AUTH_STATEMENT;
    }
    throw error;
  }
}

export async function loadOrganizationRoleTemplates(
  db: NodePgDatabase<Record<string, unknown>>,
  tenantId: string | null,
): Promise<
  Array<{
    roleName: string;
    permission: string;
    permissionScopes: string;
  }>
> {
  if (!tenantId) {
    return [];
  }

  try {
    return await db
      .select({
        roleName: schema.organizationRoleTemplate.roleName,
        permission: schema.organizationRoleTemplate.permission,
        permissionScopes: schema.organizationRoleTemplate.permissionScopes,
      })
      .from(schema.organizationRoleTemplate)
      .where(eq(schema.organizationRoleTemplate.tenantId, tenantId));
  } catch (error) {
    if (isMissingRbacTables(error)) {
      return [];
    }
    throw error;
  }
}
