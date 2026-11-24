import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import { AppLoggerService } from '@/logger/logger.service';
import {
  CONFIG_INVALIDATED_CHANNEL,
  TenantContextStorage,
  type ResolvedTenantContext,
} from '@/modules/tenant';
import type { Auth } from './auth';

export const CATALOG_VERSION_REDIS_KEY = 'authcore:catalog:version';
export const DEFAULT_AUTH_RUNTIME_LRU_MAX = 200;

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

interface ConfigInvalidationMessage {
  scope?: 'tenant' | 'catalog' | 'platform';
  tenantId?: string;
  configVersion?: number;
  catalogVersion?: number;
}

@Injectable()
export class AuthRuntimeRegistry implements OnModuleInit, OnModuleDestroy {
  private platformInstance: Auth | null = null;
  private buildPlatformAuthFn: (() => Auth | Promise<Auth>) | null = null;
  private buildTenantAuthFn:
    | ((
        ctx: ResolvedTenantContext,
        catalogVersion: number,
      ) => Auth | Promise<Auth>)
    | null = null;

  private readonly lru = new Map<string, Auth>();
  private readonly inFlightBuilds = new Map<string, Promise<Auth>>();
  private maxEntries: number;
  private catalogVersion: number | null = null;
  private subscriber: AuthRuntimeRedisSubscriber | null = null;

  constructor(
    @Optional()
    @Inject(BETTER_AUTH_REDIS_CLIENT)
    private readonly redisClient?: AuthRuntimeRedisClient,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly logger?: AppLoggerService,
  ) {
    const configuredMax = Number(
      this.configService?.get<number>('AUTH_RUNTIME_LRU_MAX') ??
        process.env.AUTH_RUNTIME_LRU_MAX ??
        DEFAULT_AUTH_RUNTIME_LRU_MAX,
    );
    this.maxEntries =
      Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : DEFAULT_AUTH_RUNTIME_LRU_MAX;
  }

  initialize(options: AuthRuntimeRegistryInitOptions): void {
    this.platformInstance = options.platformInstance;
    this.buildPlatformAuthFn = options.buildPlatformAuth;
    this.buildTenantAuthFn = options.buildTenantAuth;
    if (
      typeof options.maxEntries === 'number' &&
      Number.isFinite(options.maxEntries) &&
      options.maxEntries > 0
    ) {
      this.maxEntries = options.maxEntries;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.startInvalidationSubscriber();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    const sub = this.subscriber;
    this.subscriber = null;
    try {
      await sub.unsubscribe?.(CONFIG_INVALIDATED_CHANNEL);
    } catch {
      // Ignore unsubscribe errors during shutdown
    }
    try {
      if (sub.quit) {
        await sub.quit();
      } else {
        sub.disconnect?.();
      }
    } catch {
      // Ignore disconnect errors during shutdown
    }
  }

  private async startInvalidationSubscriber(): Promise<void> {
    if (!this.redisClient?.duplicate) return;
    try {
      const sub = this.redisClient.duplicate();
      this.subscriber = sub;
      sub.on?.('message', (channel, message) => {
        if (channel !== CONFIG_INVALIDATED_CHANNEL) return;
        void this.handleInvalidationMessage(message);
      });
      await sub.connect?.().catch(() => {});
      await sub.subscribe?.(CONFIG_INVALIDATED_CHANNEL);
    } catch (error) {
      this.logger?.warn(
        `Failed to subscribe to ${CONFIG_INVALIDATED_CHANNEL}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'AuthRuntimeRegistry',
      );
    }
  }

  private async handleInvalidationMessage(raw: string): Promise<void> {
    try {
      const payload = JSON.parse(raw) as ConfigInvalidationMessage;
      if (payload.scope === 'tenant' && payload.tenantId) {
        await this.invalidateTenant(payload.tenantId, payload.configVersion);
        return;
      }
      if (payload.scope === 'catalog') {
        if (typeof payload.catalogVersion === 'number') {
          this.catalogVersion = payload.catalogVersion;
        } else {
          this.catalogVersion = null;
        }
        return;
      }
      if (payload.scope === 'platform') {
        await this.invalidatePlatform();
      }
    } catch (error) {
      this.logger?.warn(
        `Invalid config invalidation payload: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'AuthRuntimeRegistry',
      );
    }
  }

  private getPlatformInstance(): Auth {
    if (!this.platformInstance) {
      throw new Error('AuthRuntimeRegistry has not been initialized yet.');
    }
    return this.platformInstance;
  }

  private async getCatalogVersion(): Promise<number> {
    if (this.catalogVersion !== null) {
      return this.catalogVersion;
    }
    if (this.redisClient?.get) {
      try {
        const raw = await this.redisClient.get(CATALOG_VERSION_REDIS_KEY);
        const parsed = raw !== null ? Number(raw) : 0;
        this.catalogVersion = Number.isFinite(parsed) ? parsed : 0;
        return this.catalogVersion;
      } catch {
        // Fallback to 0 when Redis is unavailable
      }
    }
    this.catalogVersion = 0;
    return this.catalogVersion;
  }

  private buildCacheKey(
    ctx: ResolvedTenantContext,
    catalogVersion: number,
  ): string {
    const source = ctx.source === 'path' ? 'path' : 'subdomain';
    return `${ctx.tenantId}:${source}:${ctx.configVersion}:${catalogVersion}`;
  }

  private touchLru(key: string, instance: Auth): void {
    if (this.lru.has(key)) {
      this.lru.delete(key);
    } else if (this.lru.size >= this.maxEntries) {
      const oldestKey = this.lru.keys().next().value;
      if (oldestKey !== undefined) {
        this.lru.delete(oldestKey);
      }
    }
    this.lru.set(key, instance);
  }

  async getForContext(ctx: ResolvedTenantContext): Promise<Auth> {
    if (!ctx || ctx.tenantId === null || ctx.source === 'platform') {
      return this.getPlatformInstance();
    }

    const catalogVersion = await this.getCatalogVersion();
    const key = this.buildCacheKey(ctx, catalogVersion);

    const cached = this.lru.get(key);
    if (cached) {
      this.touchLru(key, cached);
      return cached;
    }

    const inFlight = this.inFlightBuilds.get(key);
    if (inFlight) {
      return inFlight;
    }

    if (!this.buildTenantAuthFn) {
      throw new Error('AuthRuntimeRegistry buildTenantAuth is not registered.');
    }

    const buildPromise = Promise.resolve(
      this.buildTenantAuthFn(ctx, catalogVersion),
    )
      .then((instance) => {
        this.touchLru(key, instance);
        return instance;
      })
      .finally(() => {
        this.inFlightBuilds.delete(key);
      });

    this.inFlightBuilds.set(key, buildPromise);
    return buildPromise;
  }

  async invalidateTenant(
    tenantId: string,
    _newVersion?: number,
  ): Promise<void> {
    const prefix = `${tenantId}:`;
    for (const key of Array.from(this.lru.keys())) {
      if (key.startsWith(prefix)) {
        this.lru.delete(key);
      }
    }
  }

  async invalidateCatalog(): Promise<number> {
    let nextVersion: number;
    if (this.redisClient?.incr) {
      nextVersion = await this.redisClient.incr(CATALOG_VERSION_REDIS_KEY);
    } else {
      nextVersion = (this.catalogVersion ?? 0) + 1;
    }
    this.catalogVersion = nextVersion;

    if (this.redisClient?.publish) {
      try {
        await this.redisClient.publish(
          CONFIG_INVALIDATED_CHANNEL,
          JSON.stringify({
            scope: 'catalog',
            catalogVersion: nextVersion,
          }),
        );
      } catch {
        // Best-effort broadcast
      }
    }

    return nextVersion;
  }

  async invalidatePlatform(): Promise<void> {
    if (!this.buildPlatformAuthFn) {
      throw new Error(
        'AuthRuntimeRegistry buildPlatformAuth is not registered.',
      );
    }
    this.platformInstance = await this.buildPlatformAuthFn();
  }

  createContextAwareProxy(): Auth {
    const resolveForCurrentContext = () =>
      this.getForContext(TenantContextStorage.get());
    const getPlatform = () => this.getPlatformInstance();

    const apiProxy = new Proxy({} as Record<PropertyKey, unknown>, {
      get: (_target, methodProp) => {
        const platformApi = (
          getPlatform() as unknown as { api?: Record<PropertyKey, unknown> }
        ).api;
        const sample = platformApi?.[methodProp];
        if (typeof sample === 'function') {
          return async (...args: unknown[]) => {
            const instance = await resolveForCurrentContext();
            const apiObj = (
              instance as unknown as { api: Record<PropertyKey, unknown> }
            ).api;
            const fn = apiObj[methodProp] as (
              ...fnArgs: unknown[]
            ) => unknown;
            return fn.apply(apiObj, args);
          };
        }
        return sample;
      },
      has: (_target, methodProp) => {
        const platformApi = (
          getPlatform() as unknown as { api?: Record<PropertyKey, unknown> }
        ).api;
        return platformApi ? methodProp in platformApi : false;
      },
      ownKeys: () => {
        const platformApi = (
          getPlatform() as unknown as { api?: Record<PropertyKey, unknown> }
        ).api;
        return platformApi ? Reflect.ownKeys(platformApi) : [];
      },
      getOwnPropertyDescriptor: (_target, methodProp) => {
        const platformApi = (
          getPlatform() as unknown as { api?: Record<PropertyKey, unknown> }
        ).api;
        return platformApi
          ? Object.getOwnPropertyDescriptor(platformApi, methodProp)
          : undefined;
      },
    });

    const handlerProxy = async (req: Request) => {
      const instance = await resolveForCurrentContext();
      return instance.handler(req);
    };

    return new Proxy(handlerProxy as unknown as Auth, {
      get: (_target, prop) => {
        if (prop === 'handler') {
          return handlerProxy;
        }
        if (prop === 'api') {
          return apiProxy;
        }
        const platform = getPlatform();
        const value = (platform as unknown as Record<PropertyKey, unknown>)[
          prop
        ];
        if (typeof value === 'function') {
          return (value as (...args: unknown[]) => unknown).bind(platform);
        }
        return value;
      },
      has: (_target, prop) => prop in getPlatform(),
      ownKeys: () => Reflect.ownKeys(getPlatform()),
      getOwnPropertyDescriptor: (_target, prop) =>
        Object.getOwnPropertyDescriptor(getPlatform(), prop),
    });
  }
}
