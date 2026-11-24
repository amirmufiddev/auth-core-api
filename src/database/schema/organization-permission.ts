import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { baseColumns, baseIndexes } from './_base';
import { tenant } from './tenant';
import { tenantIdNotBlank, tenantScopeColumn } from './tenant-scope';

/** Katalog permission organisasi, milik satu tenant. */
export const organizationPermission = pgTable(
  'organization_permission',
  {
    ...baseColumns,
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    tenantScope: tenantScopeColumn(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    actionDisplayName: text('action_display_name').notNull(),
    actionDescription: text('action_description'),
    resourceDisplayName: text('resource_display_name').notNull(),
    resourceDescription: text('resource_description'),
  },
  (table) => [
    ...baseIndexes(table),
    index('idx_organization_permission_tenant_id').on(table.tenantId),
    index('idx_organization_permission_resource').on(table.resource),
    uniqueIndex('uq_organization_permission_tenant_resource_action_active')
      .on(table.tenantId, table.resource, table.action)
      .where(sql`${table.deletedAt} is null`),
    tenantIdNotBlank(
      'ck_organization_permission_tenant_id_not_blank',
      table.tenantId,
    ),
  ],
);

export type OrganizationPermission = typeof organizationPermission.$inferSelect;
export type NewOrganizationPermission = typeof organizationPermission.$inferInsert;

/** @deprecated Gunakan OrganizationPermission. */
export type RbacPermission = OrganizationPermission;
/** @deprecated Gunakan NewOrganizationPermission. */
export type NewRbacPermission = NewOrganizationPermission;
