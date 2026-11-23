import {
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import { AppLoggerService } from '@/logger/logger.service';
import {
  BETTER_AUTH_FEATURE_CATALOG,
  BETTER_AUTH_FEATURE_CATALOG_MAP,
  type BetterAuthFeatureId,
  type FeatureConfigMap,
  buildDefaultFeatureConfigFromEnv,
  mergeFeatureConfig,
  normalizeFeatureDependencies,
  sanitizeFeatureConfigForPublic,
} from '../config/feature-catalog';

export type FeatureConfigReloadListener = (
  config: FeatureConfigMap,
) => Promise<void> | void;

@Injectable()
export class AuthFeatureConfigService implements OnModuleInit {
  private currentConfig: FeatureConfigMap = buildDefaultFeatureConfigFromEnv();
  private readonly listeners = new Set<FeatureConfigReloadListener>();

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadFromDatabase();
  }

  onConfigUpdated(listener: FeatureConfigReloadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async loadFromDatabase(): Promise<FeatureConfigMap> {
    const base = buildDefaultFeatureConfigFromEnv();
    try {
      const rows = await this.db.select().from(schema.authFeatureConfig);
      if (rows.length === 0) {
        this.currentConfig = normalizeFeatureDependencies(base);
        return this.currentConfig;
      }

      const patch: Record<
        string,
        { enabled?: boolean; settings?: Record<string, unknown> }
      > = {};
      for (const row of rows) {
        patch[row.featureId] = {
          enabled: row.enabled,
          settings: row.settings ?? {},
        };
      }
      this.currentConfig = normalizeFeatureDependencies(
        mergeFeatureConfig(base, patch),
      );
      return this.currentConfig;
    } catch (error) {
      this.logger.warn(
        `Gagal memuat auth_feature_config dari database, menggunakan default .env: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'AuthFeatureConfigService',
      );
      this.currentConfig = normalizeFeatureDependencies(base);
      return this.currentConfig;
    }
  }

  getConfig(): FeatureConfigMap {
    return mergeFeatureConfig(this.currentConfig);
  }

  getPublicConfig(): {
    features: FeatureConfigMap;
    capabilities: Record<
      BetterAuthFeatureId,
      { available: boolean; reason?: string; packageName: string }
    >;
  } {
    const capabilities = Object.fromEntries(
      BETTER_AUTH_FEATURE_CATALOG.map((item) => [
        item.id,
        {
          available: item.available,
          ...(item.unavailableReason ? { reason: item.unavailableReason } : {}),
          packageName: item.packageName,
        },
      ]),
    ) as Record<
      BetterAuthFeatureId,
      { available: boolean; reason?: string; packageName: string }
    >;

    return {
      features: sanitizeFeatureConfigForPublic(this.currentConfig),
      capabilities,
    };
  }

  isFeatureEnabled(id: BetterAuthFeatureId): boolean {
    const meta = BETTER_AUTH_FEATURE_CATALOG_MAP[id];
    if (!meta?.available) return false;
    return Boolean(this.currentConfig[id]?.enabled);
  }

  assertFeatureEnabled(id: BetterAuthFeatureId): void {
    if (!this.isFeatureEnabled(id)) {
      const meta = BETTER_AUTH_FEATURE_CATALOG_MAP[id];
      throw new ForbiddenException({
        code: 'FEATURE_DISABLED',
        featureId: id,
        message: `Fitur "${meta?.name ?? id}" sedang dinonaktifkan di Auth Core.`,
      });
    }
  }

  async updateConfig(
    incoming: Partial<
      Record<string, { enabled?: boolean; settings?: Record<string, unknown> }>
    >,
    updatedBy?: string,
  ): Promise<FeatureConfigMap> {
    const merged = normalizeFeatureDependencies(
      mergeFeatureConfig(this.currentConfig, incoming),
    );

    await this.db.transaction(async (tx) => {
      for (const item of BETTER_AUTH_FEATURE_CATALOG) {
        const entry = merged[item.id];
        await tx
          .insert(schema.authFeatureConfig)
          .values({
            featureId: item.id,
            enabled: entry.enabled,
            settings: entry.settings,
            updatedBy: updatedBy ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.authFeatureConfig.featureId,
            set: {
              enabled: entry.enabled,
              settings: entry.settings,
              updatedBy: updatedBy ?? null,
              updatedAt: new Date(),
            },
          });
      }
    });

    this.currentConfig = merged;

    for (const listener of this.listeners) {
      await listener(merged);
    }

    return this.getConfig();
  }
}
