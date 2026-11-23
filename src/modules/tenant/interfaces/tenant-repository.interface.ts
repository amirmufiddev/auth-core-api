import type {
  NewTenant,
  Tenant,
  TenantBillingStatus,
  TenantStatus,
} from '@/database/schema';

export type TenantRow = Tenant;
export type NewTenantRow = NewTenant;

export interface ListTenantsQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: TenantStatus;
  tierId?: string;
  ownerUserId?: string;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerUserId: string;
  tierId?: string;
  billingStatus?: TenantBillingStatus;
}

export interface UpdateTenantInput {
  name?: string;
  slug?: string;
  tierId?: string;
  status?: TenantStatus;
  billingStatus?: TenantBillingStatus;
}

export const TENANT_REPOSITORY_TOKEN = Symbol('TENANT_REPOSITORY_TOKEN');

export const RESERVED_TENANT_SLUGS = [
  'auth',
  'console',
  'api',
  'admin',
  'www',
  't',
  'app',
  'docs',
  'mail',
  'status',
  'oauth',
  'sso',
  'scim',
  'billing',
  'static',
] as const;

export interface TenantSummaryCache {
  id: string;
  slug: string;
  status: 'active' | 'suspended';
  tierId: string;
  configVersion: number;
}

export interface UpdateTenantRepoOptions {
  bumpConfigVersion?: boolean;
}

export interface ITenantRepository {
  findById(id: string): Promise<TenantRow | null>;
  findBySlug(slug: string): Promise<TenantRow | null>;
  listPaginated(
    query: ListTenantsQuery,
  ): Promise<{ items: TenantRow[]; total: number }>;
  create(data: NewTenantRow): Promise<TenantRow>;
  update(
    id: string,
    patch: Partial<TenantRow>,
    options?: UpdateTenantRepoOptions,
  ): Promise<TenantRow>;
  incrementConfigVersion(id: string): Promise<number>;
  tierExists?(tierId: string): Promise<boolean>;
}
