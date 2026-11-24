import { AsyncLocalStorage } from 'node:async_hooks';

export interface RlsStore {
  tenantId: string | null;
  organizationId: string | null;
}

const storage = new AsyncLocalStorage<RlsStore>();

export class RlsContext {
  static run<T>(ctx: RlsStore, fn: () => T): T {
    const store: RlsStore = {
      tenantId: ctx.tenantId ?? null,
      organizationId: ctx.organizationId ?? null,
    };
    return storage.run(store, fn);
  }

  static hasStore(): boolean {
    return storage.getStore() !== undefined;
  }

  static getCurrentTenantId(): string | null {
    const store = storage.getStore();
    return store?.tenantId ?? null;
  }

  static getCurrentOrganizationId(): string | null {
    const store = storage.getStore();
    return store?.organizationId ?? null;
  }
}