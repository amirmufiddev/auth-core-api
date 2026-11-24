import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  IPortalTenantOrgRepository,
  ListTenantOrgsQuery,
  PortalTenantOrgRow,
} from '../interfaces/portal-tenant-org-repository.interface';

@Injectable()
export class PortalTenantOrgRepository implements IPortalTenantOrgRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listByTenantPaginated(
    query: ListTenantOrgsQuery,
  ): Promise<{ items: PortalTenantOrgRow[]; total: number }> {
    const conditions: SQL[] = [
      eq(schema.organization.tenantId, query.tenantId),
    ];
    const trimmedSearch = query.search?.trim();

    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.organization.name, pattern),
          ilike(schema.organization.slug, pattern),
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
        .from(schema.organization)
        .where(whereClause)
        .orderBy(desc(schema.organization.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.organization)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }
}
