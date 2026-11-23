import { Inject, Injectable } from '@nestjs/common';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { BusinessError } from '@/common/errors/business-error';
import type {
  TenantBillingRecordStatus,
  TenantBillingStatus,
} from '@/database/schema';
import {
  BILLING_REPOSITORY_TOKEN,
  type BillingRecordRow,
  type IBillingRepository,
  type ListBillingRecordsQuery,
  type RecordBillingInput,
} from '../interfaces/billing-repository.interface';

const RECORD_STATUS_TO_TENANT_BILLING_STATUS: Record<
  TenantBillingRecordStatus,
  TenantBillingStatus | undefined
> = {
  paid: 'active',
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  manual_invoice: 'manual_invoice',
  void: undefined,
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_REPOSITORY_TOKEN)
    private readonly billingRepo: IBillingRepository,
  ) {}

  async listRecords(query: ListBillingRecordsQuery): Promise<{
    items: BillingRecordRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const paging = clampZeroBasedPagination(query.page, query.pageSize);
    const { items, total } = await this.billingRepo.listPaginated({
      page: paging.page,
      pageSize: paging.pageSize,
      tenantId: query.tenantId,
      tierId: query.tierId,
      status: query.status,
    });

    return {
      items,
      total,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async getRecordById(id: string): Promise<BillingRecordRow> {
    const record = await this.billingRepo.findById(id);
    if (!record) {
      throw BusinessError.notFound('BillingRecord', id);
    }
    return record;
  }

  async recordBilling(
    input: RecordBillingInput,
    recordedBy?: string | null,
  ): Promise<BillingRecordRow> {
    const periodStart =
      input.periodStart instanceof Date
        ? input.periodStart
        : new Date(input.periodStart);
    const periodEnd =
      input.periodEnd instanceof Date
        ? input.periodEnd
        : new Date(input.periodEnd);

    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd.getTime() <= periodStart.getTime()
    ) {
      throw BusinessError.badRequest(
        'Periode billing tidak valid: periodEnd harus lebih besar dari periodStart.',
        'INVALID_BILLING_PERIOD',
      );
    }

    if (!Number.isInteger(input.amount) || input.amount < 0) {
      throw BusinessError.badRequest(
        'Nominal billing harus berupa bilangan bulat >= 0.',
        'INVALID_BILLING_AMOUNT',
      );
    }

    const [tenantOk, tierOk] = await Promise.all([
      this.billingRepo.tenantExists(input.tenantId),
      this.billingRepo.tierExists(input.tierId),
    ]);

    if (!tenantOk) {
      throw BusinessError.notFound('Tenant', input.tenantId);
    }

    if (!tierOk) {
      throw BusinessError.badRequest(
        `Tier '${input.tierId}' tidak ditemukan.`,
        'INVALID_TIER',
        { tierId: input.tierId },
      );
    }

    const nextTenantBillingStatus =
      input.tenantBillingStatus ??
      RECORD_STATUS_TO_TENANT_BILLING_STATUS[input.status];

    return this.billingRepo.recordAndSyncTenantStatus({
      record: {
        tenantId: input.tenantId,
        tierId: input.tierId,
        status: input.status,
        amount: input.amount,
        currency: (input.currency?.trim() || 'IDR').toUpperCase(),
        periodStart,
        periodEnd,
        note: input.note?.trim() || null,
        recordedBy: recordedBy ?? null,
      },
      nextTenantBillingStatus,
    });
  }
}
