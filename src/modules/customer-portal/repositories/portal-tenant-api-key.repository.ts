import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  IPortalTenantApiKeyRepository,
  ListPortalTenantApiKeysQuery,
  PortalTenantApiKeyWithOwnerRow,
} from '../interfaces/portal-tenant-api-key-repository.interface';

@Injectable()
export class PortalTenantApiKeyRepository implements IPortalTenantApiKeyRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listByTenantPaginated(
    query: ListPortalTenantApiKeysQuery,
  ): Promise<{ items: PortalTenantApiKeyWithOwnerRow[]; total: number }> {
    const conditions: SQL[] = [eq(schema.apikey.tenantId, query.tenantId)];
    const trimmedSearch = query.search?.trim();

    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.apikey.name, pattern),
          ilike(schema.apikey.prefix, pattern),
          ilike(schema.user.email, pattern),
        )!,
      );
    }

    const whereClause = and(...conditions);
    const { pageSize, offset } = clampZeroBasedPagination(
      query.page,
      query.pageSize,
    );

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          apiKey: schema.apikey,
          ownerEmail: schema.user.email,
        })
        .from(schema.apikey)
        .leftJoin(schema.user, eq(schema.apikey.referenceId, schema.user.id))
        .where(whereClause)
        .orderBy(desc(schema.apikey.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.apikey)
        .leftJoin(schema.user, eq(schema.apikey.referenceId, schema.user.id))
        .where(whereClause),
    ]);

    return {
      items: rows as PortalTenantApiKeyWithOwnerRow[],
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findByTenantAndId(
    tenantId: string,
    id: string,
  ): Promise<(typeof schema.apikey.$inferSelect) | null> {
    const [found] = await this.db
      .select()
      .from(schema.apikey)
      .where(and(eq(schema.apikey.id, id), eq(schema.apikey.tenantId, tenantId)))
      .limit(1);
    return found ?? null;
  }

  async deleteByTenantAndId(tenantId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.apikey)
      .where(and(eq(schema.apikey.id, id), eq(schema.apikey.tenantId, tenantId)))
      .returning({ id: schema.apikey.id });
    return deleted.length > 0;
  }
}