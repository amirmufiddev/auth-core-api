import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  IPortalTenantUserRepository,
  ListTenantUsersQuery,
  PortalTenantUserRow,
} from '../interfaces/portal-tenant-user-repository.interface';

@Injectable()
export class PortalTenantUserRepository implements IPortalTenantUserRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listByTenantPaginated(
    query: ListTenantUsersQuery,
  ): Promise<{ items: PortalTenantUserRow[]; total: number }> {
    const conditions: SQL[] = [eq(schema.user.tenantId, query.tenantId)];
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

    const whereClause = and(...conditions);
    const { pageSize, offset } = clampZeroBasedPagination(
      query.page,
      query.pageSize,
    );

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.user)
        .where(whereClause)
        .orderBy(desc(schema.user.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.user)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }
}
