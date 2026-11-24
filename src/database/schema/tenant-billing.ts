import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { authTiers } from './auth-tier';
import { user } from './better-auth-user';
import { tenantIdNotBlank, tenantScopeColumn } from './tenant-scope';

export type TenantBillingRecordStatus =
  'active' | 'trialing' | 'past_due' | 'paid' | 'manual_invoice' | 'void';

export const tenantBillingRecords = pgTable(
  'tenant_billing_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    tenantScope: tenantScopeColumn(),
    tierId: text('tier_id')
      .notNull()
      .references(() => authTiers.id),
    status: text('status').$type<TenantBillingRecordStatus>().notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').default('IDR').notNull(),
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),
    note: text('note'),
    recordedBy: text('recorded_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_tenant_billing_records_tenant_id').on(table.tenantId),
    index('idx_tenant_billing_records_tier_id').on(table.tierId),
    tenantIdNotBlank(
      'ck_tenant_billing_records_tenant_id_not_blank',
      table.tenantId,
    ),
  ],
);

export type TenantBillingRecord = typeof tenantBillingRecords.$inferSelect;
export type NewTenantBillingRecord = typeof tenantBillingRecords.$inferInsert;
