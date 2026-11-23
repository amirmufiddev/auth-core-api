import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authTiers } from './auth-tier';
import { user } from './better-auth-user';

export type TenantStatus = 'active' | 'suspended';
export type TenantBillingStatus =
  'active' | 'trialing' | 'past_due' | 'suspended' | 'manual_invoice';

export const tenant = pgTable(
  'tenant',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references((): AnyPgColumn => user.id, { onDelete: 'restrict' }),
    tierId: text('tier_id')
      .notNull()
      .references(() => authTiers.id),
    status: text('status').$type<TenantStatus>().default('active').notNull(),
    billingStatus: text('billing_status')
      .$type<TenantBillingStatus>()
      .default('active')
      .notNull(),
    configVersion: integer('config_version').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_tenant_owner_user_id').on(table.ownerUserId),
    index('idx_tenant_tier_id').on(table.tierId),
  ],
);

export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
