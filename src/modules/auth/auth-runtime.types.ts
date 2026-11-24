import type { ResolvedTenantContext } from '@/modules/tenant';
import type { Auth } from './auth';

export interface AuthRuntimeRedisSubscriber {
  connect?: () => Promise<unknown>;
  subscribe?: (channel: string) => Promise<unknown>;
  unsubscribe?: (channel: string) => Promise<unknown>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (
    event: string,
    listener: (channel: string, message: string) => void,
  ) => unknown;
}

export interface AuthRuntimeRedisClient {
  get?: (key: string) => Promise<string | null>;
  incr?: (key: string) => Promise<number>;
  publish?: (channel: string, message: string) => Promise<unknown>;
  duplicate?: () => AuthRuntimeRedisSubscriber;
}

export interface AuthRuntimeRegistryInitOptions {
  platformInstance: Auth;
  buildPlatformAuth: () => Auth | Promise<Auth>;
  buildTenantAuth: (
    ctx: ResolvedTenantContext,
    catalogVersion: number,
  ) => Auth | Promise<Auth>;
  maxEntries?: number;
}

export interface ConfigInvalidationMessage {
  scope?: 'tenant' | 'catalog' | 'platform';
  tenantId?: string;
  configVersion?: number;
  catalogVersion?: number;
}
