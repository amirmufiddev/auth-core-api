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

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'cascade',
    }),
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
  ],
);

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
