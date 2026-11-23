import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { organization } from './better-auth-organization';
import { user } from './better-auth-user';

export const team = pgTable(
  'team',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    memberCount: integer('member_count').default(0).notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [index('idx_team_organization_id').on(table.organizationId)],
);

export const teamMember = pgTable(
  'team_member',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    membershipKey: text('membership_key').unique(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_team_member_team_id').on(table.teamId),
    index('idx_team_member_user_id').on(table.userId),
  ],
);
