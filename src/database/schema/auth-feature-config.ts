import { pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const authFeatureConfig = pgTable('auth_feature_config', {
  featureId: text('feature_id').primaryKey(),
  enabled: boolean('enabled').notNull(),
  settings: jsonb('settings')
    .$type<Record<string, string | number | boolean>>()
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
