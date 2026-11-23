import { pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';

export type RolePermissionMatrix = Record<string, string[]>;

export const authCoreRole = pgTable('auth_core_role', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').default('').notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  permissions: jsonb('permissions')
    .$type<RolePermissionMatrix>()
    .default({})
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type AuthCoreRoleRow = typeof authCoreRole.$inferSelect;
export type NewAuthCoreRoleRow = typeof authCoreRole.$inferInsert;
