import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import {
  ListPortalTenantOrgsQueryDto,
  PortalTenantOrgResponseDto,
} from '../dto/customer-portal.dto';

@Injectable()
export class PortalTenantOrgsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listTenantOrganizations(
    tenantId: string,
    query: ListPortalTenantOrgsQueryDto,
  ): Promise<{
    items: PortalTenantOrgResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const requestedSize = query.pageSize ?? query.limit ?? 10;
    const { page, pageSize, offset } = clampZeroBasedPagination(
      query.page ?? 0,
      requestedSize,
    );
    const trimmedSearch = query.search?.trim();

    const conditions: SQL[] = [eq(schema.organization.tenantId, tenantId)];
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
      items: items.map(PortalTenantOrgResponseDto.fromEntity),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }
}
