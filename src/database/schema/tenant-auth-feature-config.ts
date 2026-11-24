import {
  pgTable,
  text,
  uuid,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import type { EncryptedPayload } from '../../common/crypto/crypto.service';
import { tenant } from './tenant';
import { authFeatures } from './auth-feature';
import { tenantIdNotBlank, tenantScopeColumn } from './tenant-scope';

export const tenantAuthFeatureConfig = pgTable(
  'tenant_auth_feature_config',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    tenantScope: tenantScopeColumn(),
    featureId: uuid('feature_id')
      .notNull()
      .references(() => authFeatures.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(false).notNull(),
    settings: jsonb('settings')
      .$type<Record<string, string | number | boolean>>()
      .default({})
      .notNull(),
    secrets: jsonb('secrets')
      .$type<Record<string, EncryptedPayload>>()
      .default({})
      .notNull(),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.featureId] }),
    index('idx_tenant_auth_feature_config_feature_id').on(table.featureId),
    tenantIdNotBlank(
      'ck_tenant_auth_feature_config_tenant_id_not_blank',
      table.tenantId,
    ),
  ],
);

export type TenantAuthFeatureConfigRow =
  typeof tenantAuthFeatureConfig.$inferSelect;
export type NewTenantAuthFeatureConfigRow =
  typeof tenantAuthFeatureConfig.$inferInsert;
