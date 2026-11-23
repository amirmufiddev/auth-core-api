import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
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
  ],
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;

export const organizationRole = pgTable(
  'organization_role',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'cascade',
    }),
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
  ],
);

export type OrganizationRole = typeof organizationRole.$inferSelect;
export type NewOrganizationRole = typeof organizationRole.$inferInsert;
