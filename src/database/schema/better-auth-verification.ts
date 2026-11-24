import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { tenantIdNotBlank, tenantScopeColumn } from './tenant-scope';

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_verification_tenant_id').on(table.tenantId),
    index('idx_verification_identifier').on(table.identifier),
    index('idx_verification_expires_at').on(table.expiresAt),
    tenantIdNotBlank('ck_verification_tenant_id_not_blank', table.tenantId),
  ],
);

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
