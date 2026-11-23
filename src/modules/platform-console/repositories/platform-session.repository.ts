import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { Session } from '@/database/schema';
import { normalizePagination } from '../dto/pagination.util';
import type {
  DailyTrendCount,
  IPlatformSessionRepository,
  ListSessionsQuery,
  SessionWithUserRow,
} from '../interfaces';

@Injectable()
export class PlatformSessionRepository implements IPlatformSessionRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listPaginated(
    query: ListSessionsQuery,
  ): Promise<{ items: SessionWithUserRow[]; total: number }> {
    const conditions: SQL[] = [];
    const now = new Date();

    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.user.name, pattern),
          ilike(schema.user.email, pattern),
          ilike(schema.session.ipAddress, pattern),
          ilike(schema.session.userAgent, pattern),
        )!,
      );
    }

    if (query.status === 'active') {
      conditions.push(gt(schema.session.expiresAt, now));
    } else if (query.status === 'expired') {
      conditions.push(lte(schema.session.expiresAt, now));
    }

    if (query.sinceDate) {
      const minDate = new Date(query.sinceDate);
      if (!Number.isNaN(minDate.getTime())) {
        conditions.push(gte(schema.session.createdAt, minDate));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const { pageSize, offset } = normalizePagination(
      query.page,
      query.pageSize,
    );

    const [items, countRows] = await Promise.all([
      this.db
        .select({
          id: schema.session.id,
          userId: schema.session.userId,
          userName: schema.user.name,
          userEmail: schema.user.email,
          token: schema.session.token,
          ipAddress: schema.session.ipAddress,
          userAgent: schema.session.userAgent,
          impersonatedBy: schema.session.impersonatedBy,
          createdAt: schema.session.createdAt,
          expiresAt: schema.session.expiresAt,
        })
        .from(schema.session)
        .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
        .where(whereClause)
        .orderBy(desc(schema.session.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.session)
        .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findById(id: string): Promise<Session | null> {
    const [found] = await this.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, id))
      .limit(1);
    return found ?? null;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(schema.session).where(eq(schema.session.id, id));
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db
      .delete(schema.session)
      .where(eq(schema.session.userId, userId));
  }

  async deleteExpired(): Promise<number> {
    const deleted = await this.db
      .delete(schema.session)
      .where(lte(schema.session.expiresAt, new Date()))
      .returning({ id: schema.session.id });
    return deleted.length;
  }

  async countActive(): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(schema.session)
      .where(gt(schema.session.expiresAt, new Date()));
    return Number(row?.total ?? 0);
  }

  async countCreatedByDay(since: Date): Promise<DailyTrendCount[]> {
    const dayExpr = sql<string>`to_char(date_trunc('day', ${schema.session.createdAt} AT TIME ZONE 'UTC', 'UTC') AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        day: dayExpr,
        total: count(),
      })
      .from(schema.session)
      .where(gte(schema.session.createdAt, since))
      .groupBy(dayExpr);

    return rows.map((r) => ({ day: r.day, count: Number(r.total ?? 0) }));
  }
}
