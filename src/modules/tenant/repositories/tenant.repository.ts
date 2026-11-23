import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  ITenantRepository,
  ListTenantsQuery,
  NewTenantRow,
  TenantRow,
} from '../interfaces/tenant-repository.interface';

@Injectable()
export class TenantRepository implements ITenantRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findById(id: string): Promise<TenantRow | null> {
    const [found] = await this.db
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.id, id))
      .limit(1);
    return found ?? null;
  }

  async findBySlug(slug: string): Promise<TenantRow | null> {
    const [found] = await this.db
      .select()
      .from(schema.tenant)
      .where(eq(schema.tenant.slug, slug))
      .limit(1);
    return found ?? null;
  }

  async listPaginated(
    query: ListTenantsQuery,
  ): Promise<{ items: TenantRow[]; total: number }> {
    const conditions: SQL[] = [];
    const trimmedSearch = query.search?.trim();

    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.tenant.name, pattern),
          ilike(schema.tenant.slug, pattern),
        )!,
      );
    }

    if (query.status) {
      conditions.push(eq(schema.tenant.status, query.status));
    }

    if (query.tierId?.trim()) {
      conditions.push(eq(schema.tenant.tierId, query.tierId.trim()));
    }

    if (query.ownerUserId?.trim()) {
      conditions.push(eq(schema.tenant.ownerUserId, query.ownerUserId.trim()));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const { pageSize, offset } = clampZeroBasedPagination(
      query.page,
      query.pageSize,
    );

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.tenant)
        .where(whereClause)
        .orderBy(desc(schema.tenant.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(schema.tenant).where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async create(data: NewTenantRow): Promise<TenantRow> {
    const [created] = await this.db
      .insert(schema.tenant)
      .values(data)
      .returning();
    return created;
  }

  async update(id: string, patch: Partial<TenantRow>): Promise<TenantRow> {
    const [updated] = await this.db
      .update(schema.tenant)
      .set(patch)
      .where(eq(schema.tenant.id, id))
      .returning();
    return updated;
  }

  async incrementConfigVersion(id: string): Promise<number> {
    const [updated] = await this.db
      .update(schema.tenant)
      .set({
        configVersion: sql`${schema.tenant.configVersion} + 1`,
      })
      .where(eq(schema.tenant.id, id))
      .returning({ configVersion: schema.tenant.configVersion });
    return updated?.configVersion ?? 1;
  }

  async tierExists(tierId: string): Promise<boolean> {
    const [found] = await this.db
      .select({ id: schema.authTiers.id })
      .from(schema.authTiers)
      .where(eq(schema.authTiers.id, tierId))
      .limit(1);
    return Boolean(found);
  }
}
