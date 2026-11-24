import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { tenant } from './tenant';
import {
  tenantIdNotBlank,
  tenantScopeColumn,
  userTenantScopeFk,
} from './tenant-scope';

export const deviceCode = pgTable(
  'device_code',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    deviceCode: text('device_code').notNull(),
    userCode: text('user_code').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    status: text('status').notNull(),
    lastPolledAt: timestamp('last_polled_at'),
    pollingInterval: integer('polling_interval'),
    clientId: text('client_id'),
    scope: text('scope'),
  },
  (table) => [
    index('idx_device_code_tenant_id').on(table.tenantId),
    index('idx_device_code_device_code').on(table.deviceCode),
    index('idx_device_code_user_code').on(table.userCode),
    tenantIdNotBlank('ck_device_code_tenant_id_not_blank', table.tenantId),
    userTenantScopeFk(
      'fk_device_code_user_tenant_scope',
      table.userId,
      table.tenantScope,
      user.id,
      user.tenantScope,
    ),
  ],
);

export const walletAddress = pgTable(
  'wallet_address',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    chainId: integer('chain_id').notNull(),
    isPrimary: boolean('is_primary').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_wallet_address_user_id').on(table.userId)],
);
