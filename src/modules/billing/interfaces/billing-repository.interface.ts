import type {
  NewTenantBillingRecord,
  TenantBillingRecord,
  TenantBillingRecordStatus,
  TenantBillingStatus,
} from '@/database/schema';

export type BillingRecordRow = TenantBillingRecord;
export type NewBillingRecordRow = NewTenantBillingRecord;

export interface ListBillingRecordsQuery {
  page: number;
  pageSize: number;
  tenantId?: string;
  tierId?: string;
  status?: TenantBillingRecordStatus;
}

export interface RecordBillingInput {
  tenantId: string;
  tierId: string;
  status: TenantBillingRecordStatus;
  amount: number;
  currency?: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  note?: string;
  tenantBillingStatus?: TenantBillingStatus;
}

export interface RecordBillingAndSyncInput {
  record: NewBillingRecordRow;
  nextTenantBillingStatus?: TenantBillingStatus;
}

export const BILLING_REPOSITORY_TOKEN = Symbol('BILLING_REPOSITORY_TOKEN');

export interface IBillingRepository {
  listPaginated(
    query: ListBillingRecordsQuery,
  ): Promise<{ items: BillingRecordRow[]; total: number }>;
  findById(id: string): Promise<BillingRecordRow | null>;
  tenantExists(tenantId: string): Promise<boolean>;
  tierExists(tierId: string): Promise<boolean>;
  recordAndSyncTenantStatus(
    input: RecordBillingAndSyncInput,
  ): Promise<BillingRecordRow>;
}
