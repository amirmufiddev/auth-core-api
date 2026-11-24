import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { tenant } from './tenant';
import {
  tenantIdNotBlank,
  tenantScopeColumn,
  userTenantScopeFk,
} from './tenant-scope';

export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true).notNull(),
    failedVerificationCount: integer('failed_verification_count')
      .default(0)
      .notNull(),
    lockedUntil: timestamp('locked_until'),
  },
  (table) => [
    index('idx_two_factor_tenant_id').on(table.tenantId),
    index('idx_two_factor_user_id').on(table.userId),
    tenantIdNotBlank('ck_two_factor_tenant_id_not_blank', table.tenantId),
    userTenantScopeFk(
      'fk_two_factor_user_tenant_scope',
      table.userId,
      table.tenantScope,
      user.id,
      user.tenantScope,
    ),
  ],
);

export type TwoFactor = typeof twoFactor.$inferSelect;
export type NewTwoFactor = typeof twoFactor.$inferInsert;