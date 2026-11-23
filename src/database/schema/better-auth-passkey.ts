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

export const passkey = pgTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'cascade',
    }),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at').defaultNow(),
    aaguid: text('aaguid'),
  },
  (table) => [
    index('idx_passkey_tenant_id').on(table.tenantId),
    index('idx_passkey_user_id').on(table.userId),
    index('idx_passkey_credential_id').on(table.credentialID),
  ],
);

export type Passkey = typeof passkey.$inferSelect;
export type NewPasskey = typeof passkey.$inferInsert;
