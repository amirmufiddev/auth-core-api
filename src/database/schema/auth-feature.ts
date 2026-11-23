import { pgTable, text, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core';

export type AuthFeatureStatus = 'active' | 'disabled' | 'coming_soon';

export interface AuthFeatureAvailableSetting {
  key: string;
  label: string;
  type: string;
  options?: Array<{ label: string; value: string | number | boolean } | string>;
  defaultValue?: string | number | boolean;
  required?: boolean;
}

export const authFeatures = pgTable('auth_features', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  packageName: text('package_name').notNull(),
  status: text('status').$type<AuthFeatureStatus>().default('active').notNull(),
  dependencies: text('dependencies').array().default([]).notNull(),
  availableSetting: jsonb('available_setting')
    .$type<AuthFeatureAvailableSetting[]>()
    .default([])
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type AuthFeature = typeof authFeatures.$inferSelect;
export type NewAuthFeature = typeof authFeatures.$inferInsert;
