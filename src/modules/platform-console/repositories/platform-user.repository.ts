import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { User } from '@/database/schema';
import { normalizePagination } from '../dto/pagination.util';
import type {
  CreatePlatformUserRecord,
  IPlatformUserRepository,
  ListUsersQuery,
  PlatformUserDashboardStats,
  UserProfileRelations,
} from '../interfaces';

@Injectable()
export class PlatformUserRepository implements IPlatformUserRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  private resolveOrderBy(sortBy?: string, sortDir?: string) {
    const dir = sortDir === 'desc' ? desc : asc;
    switch (sortBy) {
      case 'name':
        return dir(schema.user.name);
      case 'email':
        return dir(schema.user.email);
      case 'role':
        return dir(schema.user.role);
      case 'emailVerified':
        return dir(schema.user.emailVerified);
      case 'lastLoginMethod':
        return dir(schema.user.lastLoginMethod);
      case 'updatedAt':
      case 'lastActiveAt':
        return dir(schema.user.updatedAt);
      case 'createdAt':
        return dir(schema.user.createdAt);
      default:
        return desc(schema.user.createdAt);
    }
  }

  async listPaginated(
    query: ListUsersQuery,
  ): Promise<{ items: User[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.scope !== "all") {
      conditions.push(isNull(schema.user.tenantId));
    }

    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.user.name, pattern),
          ilike(schema.user.email, pattern),
          ilike(schema.user.username, pattern),
        )!,
      );
    }

    if (query.role && query.role !== 'all') {
      conditions.push(eq(schema.user.role, query.role));
    }

    if (query.status && query.status !== 'all') {
      if (query.status === 'banned') {
        conditions.push(eq(schema.user.banned, true));
      } else if (query.status === 'active') {
        conditions.push(
          or(eq(schema.user.banned, false), isNull(schema.user.banned))!,
        );
      } else if (query.status === 'unverified') {
        conditions.push(eq(schema.user.emailVerified, false));
      }
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;
    const { pageSize, offset } = normalizePagination(
      query.page,
      query.pageSize,
    );

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.user)
        .where(whereClause)
        .orderBy(this.resolveOrderBy(query.sortBy, query.sortDir))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(schema.user).where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findPlatformById(id: string): Promise<User | null> {
    const [found] = await this.db
      .select()
      .from(schema.user)
      .where(and(eq(schema.user.id, id), isNull(schema.user.tenantId)))
      .limit(1);
    return found ?? null;
  }

  async findPlatformByEmail(email: string): Promise<User | null> {
    const [found] = await this.db
      .select()
      .from(schema.user)
      .where(
        and(
          eq(schema.user.email, email.toLowerCase()),
          isNull(schema.user.tenantId),
        ),
      )
      .limit(1);
    return found ?? null;
  }

  async createPlatformUser(input: CreatePlatformUserRecord): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.user)
        .values({
          id: input.id,
          tenantId: null,
          name: input.name,
          email: input.email,
          emailVerified: input.emailVerified,
          role: input.role,
          username: input.username,
          displayUsername: input.username,
          twoFactorEnabled: input.twoFactorEnabled,
          lastLoginMethod: 'email',
        })
        .returning();

      await tx.insert(schema.account).values({
        id: input.accountId,
        accountId: input.id,
        providerId: 'credential',
        userId: input.id,
        password: input.passwordHash,
      });

      return created;
    });
  }

  async updatePlatformUser(id: string, patch: Partial<User>): Promise<User> {
    const [updated] = await this.db
      .update(schema.user)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.user.id, id), isNull(schema.user.tenantId)))
      .returning();
    return updated;
  }

  async deletePlatformUser(id: string): Promise<void> {
    await this.db
      .delete(schema.user)
      .where(and(eq(schema.user.id, id), isNull(schema.user.tenantId)));
  }

  async getProfileRelations(userId: string): Promise<UserProfileRelations> {
    const [accounts, passkeys, memberships] = await Promise.all([
      this.db
        .select({ providerId: schema.account.providerId })
        .from(schema.account)
        .where(eq(schema.account.userId, userId)),
      this.db
        .select()
        .from(schema.passkey)
        .where(eq(schema.passkey.userId, userId)),
      this.db
        .select({ orgName: schema.organization.name })
        .from(schema.member)
        .innerJoin(
          schema.organization,
          eq(schema.member.organizationId, schema.organization.id),
        )
        .where(eq(schema.member.userId, userId))
        .limit(1),
    ]);

    return {
      accounts,
      passkeys,
      organizationName: memberships[0]?.orgName,
    };
  }

  async getPasskeyCounts(userIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (userIds.length === 0) return map;

    const rows = await this.db
      .select({
        userId: schema.passkey.userId,
        total: count(),
      })
      .from(schema.passkey)
      .where(inArray(schema.passkey.userId, userIds))
      .groupBy(schema.passkey.userId);

    for (const row of rows) {
      map.set(row.userId, Number(row.total ?? 0));
    }
    return map;
  }

  async getPrimaryOrgNames(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (userIds.length === 0) return map;

    const rows = await this.db
      .select({
        userId: schema.member.userId,
        orgName: schema.organization.name,
      })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.member.organizationId, schema.organization.id),
      )
      .where(inArray(schema.member.userId, userIds));

    for (const row of rows) {
      if (!map.has(row.userId)) {
        map.set(row.userId, row.orgName);
      }
    }
    return map;
  }

  async getDashboardStats(): Promise<PlatformUserDashboardStats> {
    const platformOnly = isNull(schema.user.tenantId);

    const [totalsRows, methodRows] = await Promise.all([
      this.db
        .select({
          totalUsers: count(),
          bannedUsers: sql<number>`count(*) filter (where ${schema.user.banned} = true)`,
          twoFactorUsers: sql<number>`count(*) filter (where ${schema.user.twoFactorEnabled} = true)`,
        })
        .from(schema.user)
        .where(platformOnly),
      this.db
        .select({
          method: sql<string>`upper(coalesce(${schema.user.lastLoginMethod}, 'email'))`,
          total: count(),
        })
        .from(schema.user)
        .where(platformOnly)
        .groupBy(sql`upper(coalesce(${schema.user.lastLoginMethod}, 'email'))`),
    ]);

    const totals = totalsRows[0];
    return {
      totalUsers: Number(totals?.totalUsers ?? 0),
      bannedUsers: Number(totals?.bannedUsers ?? 0),
      twoFactorUsers: Number(totals?.twoFactorUsers ?? 0),
      authMethodDistribution:
        methodRows.length > 0
          ? methodRows.map((r) => ({
              method: r.method,
              count: Number(r.total ?? 0),
            }))
          : [{ method: 'EMAIL', count: 0 }],
    };
  }

  async getUserCountsByRole(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        role: sql<string>`coalesce(${schema.user.role}, 'user')`,
        total: count(),
      })
      .from(schema.user)
      .where(isNull(schema.user.tenantId))
      .groupBy(sql`coalesce(${schema.user.role}, 'user')`);

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.role, Number(row.total ?? 0));
    }
    return map;
  }
}
