import { describe, expect, it, mock } from 'bun:test';
import { BusinessError } from '@/common/errors/business-error';
import type { TenantBillingRecord } from '@/database/schema';
import type { IBillingRepository } from '../interfaces/billing-repository.interface';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  const makeRecord = (
    overrides: Partial<TenantBillingRecord> = {},
  ): TenantBillingRecord => ({
    id: '550e8400-e29b-41d4-a716-446655440000',
    tenantId: 'ten_1',
    tierId: 'tier_business',
    status: 'paid',
    amount: 499000,
    currency: 'IDR',
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-12-01T00:00:00Z'),
    note: 'Invoice November 2026',
    recordedBy: 'usr_admin',
    createdAt: new Date('2026-11-24T00:00:00Z'),
    ...overrides,
  });

  const createMocks = () => {
    const billingRepo: IBillingRepository = {
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      findById: mock(() => Promise.resolve(makeRecord())),
      tenantExists: mock(() => Promise.resolve(true)),
      tierExists: mock(() => Promise.resolve(true)),
      recordAndSyncTenantStatus: mock((input) =>
        Promise.resolve(
          makeRecord({
            tenantId: input.record.tenantId,
            tierId: input.record.tierId,
            status: input.record.status,
            amount: input.record.amount,
            currency: input.record.currency ?? 'IDR',
            periodStart: input.record.periodStart,
            periodEnd: input.record.periodEnd,
            note: input.record.note ?? null,
            recordedBy: input.record.recordedBy ?? null,
          }),
        ),
      ),
    };

    return { billingRepo };
  };

  it('should record billing ledger entry and map paid status to active tenant billingStatus', async () => {
    const { billingRepo } = createMocks();
    const service = new BillingService(billingRepo);

    const record = await service.recordBilling(
      {
        tenantId: 'ten_1',
        tierId: 'tier_business',
        status: 'paid',
        amount: 499000,
        currency: 'IDR',
        periodStart: '2026-11-01T00:00:00Z',
        periodEnd: '2026-12-01T00:00:00Z',
        note: 'Invoice November 2026',
      },
      'usr_admin',
    );

    expect(record.status).toBe('paid');
    expect(billingRepo.recordAndSyncTenantStatus).toHaveBeenCalledWith({
      record: expect.objectContaining({
        tenantId: 'ten_1',
        tierId: 'tier_business',
        status: 'paid',
        amount: 499000,
        currency: 'IDR',
        recordedBy: 'usr_admin',
      }),
      nextTenantBillingStatus: 'active',
    });
  });

  it('should sync past_due and manual_invoice directly to tenant.billingStatus', async () => {
    const { billingRepo } = createMocks();
    const service = new BillingService(billingRepo);

    await service.recordBilling(
      {
        tenantId: 'ten_1',
        tierId: 'tier_business',
        status: 'past_due',
        amount: 499000,
        periodStart: '2026-11-01T00:00:00Z',
        periodEnd: '2026-12-01T00:00:00Z',
      },
      'usr_admin',
    );

    expect(billingRepo.recordAndSyncTenantStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextTenantBillingStatus: 'past_due' }),
    );
  });

  it('should not overwrite tenant.billingStatus when recording a void entry without explicit override', async () => {
    const { billingRepo } = createMocks();
    const service = new BillingService(billingRepo);

    await service.recordBilling(
      {
        tenantId: 'ten_1',
        tierId: 'tier_business',
        status: 'void',
        amount: 0,
        periodStart: '2026-11-01T00:00:00Z',
        periodEnd: '2026-12-01T00:00:00Z',
      },
      'usr_admin',
    );

    expect(billingRepo.recordAndSyncTenantStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextTenantBillingStatus: undefined }),
    );
  });

  it('should reject invalid billing period where periodEnd <= periodStart', async () => {
    const { billingRepo } = createMocks();
    const service = new BillingService(billingRepo);

    let caught: unknown;
    try {
      await service.recordBilling(
        {
          tenantId: 'ten_1',
          tierId: 'tier_business',
          status: 'paid',
          amount: 100000,
          periodStart: '2026-12-01T00:00:00Z',
          periodEnd: '2026-11-01T00:00:00Z',
        },
        'usr_admin',
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(400);
    expect((caught as BusinessError).code).toBe('INVALID_BILLING_PERIOD');
  });

  it('should reject unknown tenant with 404 TENANT_NOT_FOUND', async () => {
    const { billingRepo } = createMocks();
    (billingRepo.tenantExists as ReturnType<typeof mock>).mockResolvedValue(
      false,
    );
    const service = new BillingService(billingRepo);

    let caught: unknown;
    try {
      await service.recordBilling(
        {
          tenantId: 'ten_missing',
          tierId: 'tier_business',
          status: 'paid',
          amount: 100000,
          periodStart: '2026-11-01T00:00:00Z',
          periodEnd: '2026-12-01T00:00:00Z',
        },
        'usr_admin',
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).httpStatus).toBe(404);
    expect((caught as BusinessError).code).toBe('TENANT_NOT_FOUND');
  });

  it('should clamp negative page and oversized pageSize on listRecords', async () => {
    const { billingRepo } = createMocks();
    const service = new BillingService(billingRepo);

    const res = await service.listRecords({ page: -1, pageSize: 250 });
    expect(res.page).toBe(0);
    expect(res.pageSize).toBe(100);
    expect(billingRepo.listPaginated).toHaveBeenCalledWith({
      page: 0,
      pageSize: 100,
      tenantId: undefined,
      tierId: undefined,
      status: undefined,
    });
  });
});
