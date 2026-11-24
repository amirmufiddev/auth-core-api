import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import {
  organizationTenantScopeFk,
  tenantIdNotBlank,
  tenantScopeColumn,
} from './tenant-scope';

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    tenantScope: tenantScopeColumn(),
    name: text('name').notNull(),
    slug: text('slug'),
    logo: text('logo'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    metadata: text('metadata'),
  },
  (table) => [
    index('idx_organization_tenant_id').on(table.tenantId),
    index('idx_organization_slug').on(table.slug),
    uniqueIndex('uq_organization_tenant_slug').on(table.tenantId, table.slug),
    uniqueIndex('uq_organization_id_tenant_scope').on(
      table.id,
      table.tenantScope,
    ),
    tenantIdNotBlank('ck_organization_tenant_id_not_blank', table.tenantId),
  ],
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;

export const organizationRole = pgTable(
  'organization_role',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    permission: text('permission').default('{}'),
    permissionScopes: text('permission_scopes').default('{}'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_organization_role_tenant_id').on(table.tenantId),
    index('idx_organization_role_organization_id').on(table.organizationId),
    tenantIdNotBlank(
      'ck_organization_role_tenant_id_not_blank',
      table.tenantId,
    ),
    organizationTenantScopeFk(
      'fk_organization_role_org_tenant_scope',
      table.organizationId,
      table.tenantScope,
      organization.id,
      organization.tenantScope,
    ),
  ],
);

export type OrganizationRole = typeof organizationRole.$inferSelect;
export type NewOrganizationRole = typeof organizationRole.$inferInsert;
