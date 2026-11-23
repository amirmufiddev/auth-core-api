import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
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
import type { AuditTrailLog } from '@/database/schema';
import type {
  CreatePlatformAuditRecord,
  DailyTrendCount,
  IPlatformAuditRepository,
  ListAuditLogsQuery,
} from '../interfaces';

@Injectable()
export class PlatformAuditRepository implements IPlatformAuditRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(input: CreatePlatformAuditRecord): Promise<void> {
    await this.db.insert(schema.auditTrailLogs).values(input);
  }

  async listPaginated(
    query: ListAuditLogsQuery,
  ): Promise<{ items: AuditTrailLog[]; total: number }> {
    const conditions: SQL[] = [];

    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.auditTrailLogs.action, pattern),
          ilike(schema.auditTrailLogs.actorEmail, pattern),
          ilike(schema.auditTrailLogs.target, pattern),
          ilike(schema.auditTrailLogs.ipAddress, pattern),
        )!,
      );
    }

    if (query.severity && query.severity !== 'all') {
      conditions.push(eq(schema.auditTrailLogs.severity, query.severity));
    }

    if (query.category && query.category !== 'all') {
      conditions.push(eq(schema.auditTrailLogs.category, query.category));
    }

    if (query.fromDate) {
      const minDate = new Date(query.fromDate);
      if (!Number.isNaN(minDate.getTime())) {
        conditions.push(gte(schema.auditTrailLogs.createdAt, minDate));
      }
    }

    if (query.toDate) {
      const maxDate = new Date(`${query.toDate}T23:59:59.999`);
      if (!Number.isNaN(maxDate.getTime())) {
        conditions.push(lte(schema.auditTrailLogs.createdAt, maxDate));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = Math.max(0, query.cursor);

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.auditTrailLogs)
        .where(whereClause)
        .orderBy(desc(schema.auditTrailLogs.createdAt))
        .limit(query.limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.auditTrailLogs)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async listRecent(limit: number): Promise<AuditTrailLog[]> {
    return this.db
      .select()
      .from(schema.auditTrailLogs)
      .orderBy(desc(schema.auditTrailLogs.createdAt))
      .limit(limit);
  }

  async countSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(schema.auditTrailLogs)
      .where(gte(schema.auditTrailLogs.createdAt, since));
    return Number(row?.total ?? 0);
  }

  async countCreatedByDay(since: Date): Promise<DailyTrendCount[]> {
    const dayExpr = sql<string>`to_char(date_trunc('day', ${schema.auditTrailLogs.createdAt}), 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        day: dayExpr,
        total: count(),
      })
      .from(schema.auditTrailLogs)
      .where(gte(schema.auditTrailLogs.createdAt, since))
      .groupBy(dayExpr);

    return rows.map((r) => ({ day: r.day, count: Number(r.total ?? 0) }));
  }
}
