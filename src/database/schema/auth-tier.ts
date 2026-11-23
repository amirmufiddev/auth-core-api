import {
  pgTable,
  text,
  integer,
  boolean,
  uuid,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { authFeatures } from './auth-feature';

export const authTiers = pgTable('auth_tiers', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type AuthTier = typeof authTiers.$inferSelect;
export type NewAuthTier = typeof authTiers.$inferInsert;

export const authTierFeatures = pgTable(
  'auth_tier_features',
  {
    tierId: text('tier_id')
      .notNull()
      .references(() => authTiers.id, { onDelete: 'cascade' }),
    featureId: uuid('feature_id')
      .notNull()
      .references(() => authFeatures.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.tierId, table.featureId] }),
    index('idx_auth_tier_features_feature_id').on(table.featureId),
  ],
);

export type AuthTierFeature = typeof authTierFeatures.$inferSelect;
export type NewAuthTierFeature = typeof authTierFeatures.$inferInsert;
