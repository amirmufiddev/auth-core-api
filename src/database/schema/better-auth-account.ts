import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { tenant } from './tenant';
import {
  tenantIdNotBlank,
  tenantScopeColumn,
  userTenantScopeFk,
} from './tenant-scope';

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_account_tenant_id').on(table.tenantId),
    index('idx_account_user_id').on(table.userId),
    uniqueIndex('uq_account_platform_provider_account')
      .on(table.providerId, table.accountId)
      .where(sql`${table.tenantId} IS NULL`),
    uniqueIndex('uq_account_tenant_provider_account')
      .on(table.tenantId, table.providerId, table.accountId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    tenantIdNotBlank('ck_account_tenant_id_not_blank', table.tenantId),
    userTenantScopeFk(
      'fk_account_user_tenant_scope',
      table.userId,
      table.tenantScope,
      user.id,
      user.tenantScope,
    ),
  ],
);

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;