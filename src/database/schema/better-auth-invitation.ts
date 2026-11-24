import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { organization } from './better-auth-organization';
import { tenant } from './tenant';
import {
  organizationTenantScopeFk,
  tenantIdNotBlank,
  tenantScopeColumn,
} from './tenant-scope';

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    teamId: text('team_id'),
    status: text('status').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_invitation_tenant_id').on(table.tenantId),
    index('idx_invitation_organization_id').on(table.organizationId),
    index('idx_invitation_email').on(table.email),
    index('idx_invitation_expires_at').on(table.expiresAt),
    tenantIdNotBlank('ck_invitation_tenant_id_not_blank', table.tenantId),
    organizationTenantScopeFk(
      'fk_invitation_org_tenant_scope',
      table.organizationId,
      table.tenantScope,
      organization.id,
      organization.tenantScope,
    ),
  ],
);

export type Invitation = typeof invitation.$inferSelect;
export type NewInvitation = typeof invitation.$inferInsert;