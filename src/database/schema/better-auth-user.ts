import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references((): AnyPgColumn => tenant.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires'),
    username: text('username'),
    displayUsername: text('display_username'),
    phoneNumber: text('phone_number'),
    phoneNumberVerified: boolean('phone_number_verified').default(false),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    isAnonymous: boolean('is_anonymous').default(false),
    lastLoginMethod: text('last_login_method'),
    stripeCustomerId: text('stripe_customer_id'),
    dodoCustomerId: text('dodo_customer_id'),
    creemCustomerId: text('creem_customer_id'),
    hadTrial: boolean('had_trial').default(false),
    chargebeeCustomerId: text('chargebee_customer_id'),
  },
  (table) => [
    index('idx_user_tenant_id').on(table.tenantId),
    index('idx_user_email').on(table.email),
    index('idx_user_username').on(table.username),
    index('idx_user_phone_number').on(table.phoneNumber),
    uniqueIndex('uq_user_platform_email')
      .on(table.email)
      .where(sql`${table.tenantId} IS NULL`),
    uniqueIndex('uq_user_tenant_email')
      .on(table.tenantId, table.email)
      .where(sql`${table.tenantId} IS NOT NULL`),
    uniqueIndex('uq_user_platform_username')
      .on(table.username)
      .where(sql`${table.tenantId} IS NULL AND ${table.username} IS NOT NULL`),
    uniqueIndex('uq_user_tenant_username')
      .on(table.tenantId, table.username)
      .where(
        sql`${table.tenantId} IS NOT NULL AND ${table.username} IS NOT NULL`,
      ),
    uniqueIndex('uq_user_platform_phone')
      .on(table.phoneNumber)
      .where(
        sql`${table.tenantId} IS NULL AND ${table.phoneNumber} IS NOT NULL`,
      ),
    uniqueIndex('uq_user_tenant_phone')
      .on(table.tenantId, table.phoneNumber)
      .where(
        sql`${table.tenantId} IS NOT NULL AND ${table.phoneNumber} IS NOT NULL`,
      ),
  ],
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
