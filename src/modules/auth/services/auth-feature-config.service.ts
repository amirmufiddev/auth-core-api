import {
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { CryptoService, type EncryptedPayload } from '@/common/crypto';
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
import {
  collectSecretFieldKeys,
  decryptPlatformSecrets,
  isKnownCatalogFeatureCode,
  persistPlatformFeatureConfigRows,
  splitIncomingFeaturePatch,
  stripSecretKeysFromSettings,
  type PlatformFeatureConfigPatch,
} from './auth-feature-config.helper';

export type FeatureConfigReloadListener = (
  config: FeatureConfigMap,
) => Promise<void> | void;

@Injectable()
export class AuthFeatureConfigService implements OnModuleInit {
  private currentConfig: FeatureConfigMap = buildDefaultFeatureConfigFromEnv();
  private currentSecrets: Partial<
    Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>
  > = {};
  private readonly listeners = new Set<FeatureConfigReloadListener>();

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: AppLoggerService,
    @Optional() private readonly cryptoService?: CryptoService,
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
      const rows = await this.db
        .select({
          featureId: schema.authFeatureConfig.featureId,
          featureCode: schema.authFeatures.code,
          enabled: schema.authFeatureConfig.enabled,
          settings: schema.authFeatureConfig.settings,
          secrets: schema.authFeatureConfig.secrets,
          availableSetting: schema.authFeatures.availableSetting,
        })
        .from(schema.authFeatureConfig)
        .innerJoin(
          schema.authFeatures,
          eq(schema.authFeatureConfig.featureId, schema.authFeatures.id),
        );

      if (rows.length === 0) {
        this.currentConfig = normalizeFeatureDependencies(base);
        this.currentSecrets = {};
        return this.currentConfig;
      }

      const patch: Record<
        string,
        { enabled?: boolean; settings?: Record<string, unknown> }
      > = {};
      const nextSecrets: Partial<
        Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>
      > = {};

      for (const row of rows) {
        if (!isKnownCatalogFeatureCode(row.featureCode)) continue;
        const secretKeys = collectSecretFieldKeys(
          row.featureCode,
          row.availableSetting,
        );
        patch[row.featureCode] = {
          enabled: row.enabled,
          settings: stripSecretKeysFromSettings(row.settings, secretKeys),
        };
        if (row.secrets && Object.keys(row.secrets).length > 0) {
          nextSecrets[row.featureCode] = row.secrets;
        }
      }

      this.currentConfig = normalizeFeatureDependencies(
        mergeFeatureConfig(base, patch),
      );
      this.currentSecrets = nextSecrets;
      return this.currentConfig;
    } catch (error) {
      this.logger.warn(
        `Gagal memuat auth_feature_config dari database, menggunakan default .env: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'AuthFeatureConfigService',
      );
      this.currentConfig = normalizeFeatureDependencies(base);
      this.currentSecrets = {};
      return this.currentConfig;
    }
  }

  getConfig(): FeatureConfigMap {
    return mergeFeatureConfig(this.currentConfig);
  }

  getDecryptedSecrets(): Partial<
    Record<BetterAuthFeatureId, Record<string, string>>
  > {
    return decryptPlatformSecrets(
      this.cryptoService,
      this.currentConfig,
      this.currentSecrets,
      this.logger,
    );
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
      features: sanitizeFeatureConfigForPublic(
        this.currentConfig,
        this.currentSecrets,
      ),
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
    incoming: Partial<Record<string, PlatformFeatureConfigPatch>>,
    updatedBy?: string,
  ): Promise<FeatureConfigMap> {
    const cleanIncoming: Record<
      string,
      { enabled?: boolean; settings?: Record<string, unknown> }
    > = {};

    for (const item of BETTER_AUTH_FEATURE_CATALOG) {
      const split = splitIncomingFeaturePatch(item.id, incoming?.[item.id]);
      if (split.cleanPatch) {
        cleanIncoming[item.id] = split.cleanPatch;
      }
    }

    const merged = normalizeFeatureDependencies(
      mergeFeatureConfig(this.currentConfig, cleanIncoming),
    );

    let nextSecrets: Partial<
      Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>
    > = { ...this.currentSecrets };

    await this.db.transaction(async (tx) => {
      nextSecrets = await persistPlatformFeatureConfigRows({
        tx,
        incoming,
        merged,
        currentSecrets: this.currentSecrets,
        updatedBy,
        cryptoService: this.cryptoService,
      });
    });

    this.currentConfig = merged;
    this.currentSecrets = nextSecrets;

    for (const listener of this.listeners) {
      await listener(merged);
    }

    return this.getConfig();
  }
}
