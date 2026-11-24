import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { organization } from './better-auth-organization';
import { tenant } from './tenant';
import {
  organizationTenantScopeFk,
  tenantIdNotBlank,
  tenantScopeColumn,
  userTenantScopeFk,
} from './tenant-scope';

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id').references(
      () => organization.id,
      { onDelete: 'cascade' },
    ),
    activeTeamId: text('active_team_id'),
    impersonatedBy: text('impersonated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('idx_session_tenant_id').on(table.tenantId),
    index('idx_session_user_id').on(table.userId),
    index('idx_session_token').on(table.token),
    index('idx_session_expires_at').on(table.expiresAt),
    tenantIdNotBlank('ck_session_tenant_id_not_blank', table.tenantId),
    userTenantScopeFk(
      'fk_session_user_tenant_scope',
      table.userId,
      table.tenantScope,
      user.id,
      user.tenantScope,
    ),
    organizationTenantScopeFk(
      'fk_session_active_org_tenant_scope',
      table.activeOrganizationId,
      table.tenantScope,
      organization.id,
      organization.tenantScope,
    ),
  ],
);

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;