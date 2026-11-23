import {
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EncryptedPayload } from '../../common/crypto/crypto.service';
import { authFeatures } from './auth-feature';

export const authFeatureConfig = pgTable('auth_feature_config', {
  featureId: uuid('feature_id')
    .primaryKey()
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
});

export type AuthFeatureConfigRow = typeof authFeatureConfig.$inferSelect;
export type NewAuthFeatureConfigRow = typeof authFeatureConfig.$inferInsert;
