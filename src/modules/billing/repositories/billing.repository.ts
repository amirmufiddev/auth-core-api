import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  BillingRecordRow,
  IBillingRepository,
  ListBillingRecordsQuery,
  RecordBillingAndSyncInput,
} from '../interfaces/billing-repository.interface';

@Injectable()
export class BillingRepository implements IBillingRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listPaginated(
    query: ListBillingRecordsQuery,
  ): Promise<{ items: BillingRecordRow[]; total: number }> {
    const conditions: SQL[] = [];

    if (query.tenantId?.trim()) {
      conditions.push(
        eq(schema.tenantBillingRecords.tenantId, query.tenantId.trim()),
      );
    }
    if (query.tierId?.trim()) {
      conditions.push(
        eq(schema.tenantBillingRecords.tierId, query.tierId.trim()),
      );
    }
    if (query.status) {
      conditions.push(eq(schema.tenantBillingRecords.status, query.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const { pageSize, offset } = clampZeroBasedPagination(
      query.page,
      query.pageSize,
    );

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.tenantBillingRecords)
        .where(whereClause)
        .orderBy(desc(schema.tenantBillingRecords.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.tenantBillingRecords)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findById(id: string): Promise<BillingRecordRow | null> {
    const [found] = await this.db
      .select()
      .from(schema.tenantBillingRecords)
      .where(eq(schema.tenantBillingRecords.id, id))
      .limit(1);
    return found ?? null;
  }

  async tenantExists(tenantId: string): Promise<boolean> {
    const [found] = await this.db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId))
      .limit(1);
    return Boolean(found);
  }

  async tierExists(tierId: string): Promise<boolean> {
    const [found] = await this.db
      .select({ id: schema.authTiers.id })
      .from(schema.authTiers)
      .where(eq(schema.authTiers.id, tierId))
      .limit(1);
    return Boolean(found);
  }

  async recordAndSyncTenantStatus(
    input: RecordBillingAndSyncInput,
  ): Promise<BillingRecordRow> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.tenantBillingRecords)
        .values(input.record)
        .returning();

      if (input.nextTenantBillingStatus) {
        await tx
          .update(schema.tenant)
          .set({ billingStatus: input.nextTenantBillingStatus })
          .where(eq(schema.tenant.id, input.record.tenantId));
      }

      return created;
    });
  }
}
