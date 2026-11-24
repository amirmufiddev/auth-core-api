import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { tenantIdNotBlank, tenantScopeColumn } from './tenant-scope';

/** Template role yang disalin ke organization baru di dalam tenant yang sama. */
export const organizationRoleTemplate = pgTable(
  'organization_role_template',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    tenantScope: tenantScopeColumn(),
    roleName: text('role_name').notNull(),
    permission: text('permission').notNull(),
    permissionScopes: text('permission_scopes').notNull().default('{}'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.roleName] }),
    index('idx_organization_role_template_tenant_id').on(table.tenantId),
    tenantIdNotBlank(
      'ck_organization_role_template_tenant_id_not_blank',
      table.tenantId,
    ),
  ],
);

export type OrganizationRoleTemplate =
  typeof organizationRoleTemplate.$inferSelect;
export type NewOrganizationRoleTemplate =
  typeof organizationRoleTemplate.$inferInsert;

/** @deprecated Gunakan OrganizationRoleTemplate. */
export type RbacRoleTemplate = OrganizationRoleTemplate;
/** @deprecated Gunakan NewOrganizationRoleTemplate. */
export type NewRbacRoleTemplate = NewOrganizationRoleTemplate;
