import { AsyncLocalStorage } from 'node:async_hooks';

export interface RlsStore {
  tenantId: string | null;
  organizationId: string | null;
}

const storage = new AsyncLocalStorage<RlsStore>();

export class RlsContext {
  static run<T>(ctx: string | RlsStore, fn: () => T): T {
    const store: RlsStore =
      typeof ctx === 'string'
        ? { tenantId: null, organizationId: ctx }
        : {
            tenantId: ctx.tenantId ?? null,
            organizationId: ctx.organizationId ?? null,
          };
    return storage.run(store, fn);
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
