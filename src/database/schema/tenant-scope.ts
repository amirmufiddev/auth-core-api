import { sql, type AnyColumn, type SQLWrapper } from 'drizzle-orm';
import {
  check,
  foreignKey,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export function tenantScopeColumn() {
  return text('tenant_scope')
    .generatedAlwaysAs(sql`coalesce(tenant_id, '')`, { mode: 'stored' })
    .notNull();
}

export function tenantIdNotBlank(name: string, tenantId: SQLWrapper) {
  return check(name, sql`${tenantId} IS NULL OR ${tenantId} <> ''`);
}

export function userTenantScopeFk(
  name: string,
  userId: AnyColumn,
  tenantScope: AnyColumn,
  userIdTarget: AnyColumn,
  userScopeTarget: AnyColumn,
) {
  return foreignKey({
    name,
    columns: [userId, tenantScope] as [AnyPgColumn, AnyPgColumn],
    foreignColumns: [userIdTarget, userScopeTarget] as [
      AnyPgColumn,
      AnyPgColumn,
    ],
  }).onDelete('cascade');
}

export function organizationTenantScopeFk(
  name: string,
  organizationId: AnyColumn,
  tenantScope: AnyColumn,
  organizationIdTarget: AnyColumn,
  organizationScopeTarget: AnyColumn,
) {
  return foreignKey({
    name,
    columns: [organizationId, tenantScope] as [AnyPgColumn, AnyPgColumn],
    foreignColumns: [organizationIdTarget, organizationScopeTarget] as [
      AnyPgColumn,
      AnyPgColumn,
    ],
  }).onDelete('cascade');
}