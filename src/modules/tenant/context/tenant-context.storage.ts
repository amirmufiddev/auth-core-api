import { AsyncLocalStorage } from 'node:async_hooks';

export interface ResolvedTenantContext {
  tenantId: string | null;
  slug: string | null;
  tierId: string | null;
  configVersion: number;
  source: 'platform' | 'subdomain' | 'path';
}

export const DEFAULT_PLATFORM_TENANT_CONTEXT: ResolvedTenantContext =
  Object.freeze({
    tenantId: null,
    slug: null,
    tierId: null,
    configVersion: 0,
    source: 'platform',
  });

const tenantContextStorage = new AsyncLocalStorage<ResolvedTenantContext>();

export class TenantContextStorage {
  static run<T>(ctx: ResolvedTenantContext, fn: () => T): T {
    return tenantContextStorage.run(ctx, fn);
  }

  static get(): ResolvedTenantContext {
    return tenantContextStorage.getStore() ?? DEFAULT_PLATFORM_TENANT_CONTEXT;
  }
}
