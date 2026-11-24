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
import {
  startAuthInvalidationSubscriber,
  stopAuthInvalidationSubscriber,
} from './auth-runtime.invalidation';
import { createContextAwareAuthProxy } from './auth-runtime.proxy';
import type {
  AuthRuntimeRedisClient,
  AuthRuntimeRedisSubscriber,
  AuthRuntimeRegistryInitOptions,
} from './auth-runtime.types';

export type {
  AuthRuntimeRedisClient,
  AuthRuntimeRedisSubscriber,
  AuthRuntimeRegistryInitOptions,
} from './auth-runtime.types';

export const CATALOG_VERSION_REDIS_KEY = 'authcore:catalog:version';
export const DEFAULT_AUTH_RUNTIME_LRU_MAX = 200;

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
  private readonly tenantInvalidationEpoch = new Map<string, number>();
  private platformInvalidationEpoch = 0;
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
    this.subscriber = await startAuthInvalidationSubscriber(
      this.redisClient,
      {
        onTenant: (tenantId, configVersion) =>
          this.invalidateTenant(tenantId, configVersion),
        onCatalog: (catalogVersion) => {
          this.catalogVersion =
            typeof catalogVersion === 'number' ? catalogVersion : null;
        },
        onPlatform: () => this.invalidatePlatform(),
      },
      this.logger,
    );
  }

  async onModuleDestroy(): Promise<void> {
    const sub = this.subscriber;
    this.subscriber = null;
    await stopAuthInvalidationSubscriber(sub);
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

    const tenantId = ctx.tenantId;
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

    const startTenantEpoch = this.tenantInvalidationEpoch.get(tenantId) ?? 0;
    const startPlatformEpoch = this.platformInvalidationEpoch;

    const buildPromise = Promise.resolve(
      this.buildTenantAuthFn(ctx, catalogVersion),
    )
      .then((instance) => {
        const currentTenantEpoch =
          this.tenantInvalidationEpoch.get(tenantId) ?? 0;
        if (
          currentTenantEpoch === startTenantEpoch &&
          this.platformInvalidationEpoch === startPlatformEpoch
        ) {
          this.touchLru(key, instance);
        }
        return instance;
      })
      .finally(() => {
        if (this.inFlightBuilds.get(key) === buildPromise) {
          this.inFlightBuilds.delete(key);
        }
      });

    this.inFlightBuilds.set(key, buildPromise);
    return buildPromise;
  }

  async invalidateTenant(
    tenantId: string,
    _newVersion?: number,
  ): Promise<void> {
    const nextEpoch = (this.tenantInvalidationEpoch.get(tenantId) ?? 0) + 1;
    this.tenantInvalidationEpoch.set(tenantId, nextEpoch);

    const prefix = `${tenantId}:`;
    for (const key of Array.from(this.lru.keys())) {
      if (key.startsWith(prefix)) {
        this.lru.delete(key);
      }
    }
    for (const key of Array.from(this.inFlightBuilds.keys())) {
      if (key.startsWith(prefix)) {
        this.inFlightBuilds.delete(key);
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
    this.platformInvalidationEpoch += 1;
    this.inFlightBuilds.clear();
    this.platformInstance = await this.buildPlatformAuthFn();
  }

  createContextAwareProxy(): Auth {
    return createContextAwareAuthProxy(
      () => this.getForContext(TenantContextStorage.get()),
      () => this.getPlatformInstance(),
    );
  }
}
