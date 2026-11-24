import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { tenant } from './tenant';
import { tenantIdNotBlank, tenantScopeColumn } from './tenant-scope';

export const auditTrailLogs = pgTable(
  'audit_trail_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'set null',
    }),
    tenantScope: tenantScopeColumn(),
    moduleKey: text('module_key').notNull(),
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    category: text('category').default('auth').notNull(),
    severity: text('severity').default('info').notNull(),
    actorEmail: text('actor_email'),
    actorRole: text('actor_role'),
    target: text('target'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_trail_logs_tenant_id').on(table.tenantId),
    index('idx_audit_trail_logs_module_key').on(table.moduleKey),
    index('idx_audit_trail_logs_actor_id').on(table.actorId),
    index('idx_audit_trail_logs_entity').on(table.entityType, table.entityId),
    index('idx_audit_trail_logs_created_at').on(table.createdAt),
    tenantIdNotBlank('ck_audit_trail_logs_tenant_id_not_blank', table.tenantId),
  ],
);

export type AuditTrailLog = typeof auditTrailLogs.$inferSelect;
export type NewAuditTrailLog = typeof auditTrailLogs.$inferInsert;
