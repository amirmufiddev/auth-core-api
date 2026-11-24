import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { organization } from './better-auth-organization';
import { tenant } from './tenant';
import {
  organizationTenantScopeFk,
  tenantIdNotBlank,
  tenantScopeColumn,
  userTenantScopeFk,
} from './tenant-scope';

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_member_tenant_id').on(table.tenantId),
    index('idx_member_organization_id').on(table.organizationId),
    index('idx_member_user_id').on(table.userId),
    uniqueIndex('idx_member_org_user_unique').on(
      table.organizationId,
      table.userId,
    ),
    tenantIdNotBlank('ck_member_tenant_id_not_blank', table.tenantId),
    userTenantScopeFk(
      'fk_member_user_tenant_scope',
      table.userId,
      table.tenantScope,
      user.id,
      user.tenantScope,
    ),
    organizationTenantScopeFk(
      'fk_member_org_tenant_scope',
      table.organizationId,
      table.tenantScope,
      organization.id,
      organization.tenantScope,
    ),
  ],
);

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;