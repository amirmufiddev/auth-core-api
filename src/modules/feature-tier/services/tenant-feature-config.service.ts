import { Inject, Injectable, Optional } from '@nestjs/common';
import { BETTER_AUTH_REDIS_CLIENT } from '@/common/auth/better-auth-cache.module';
import { CryptoService } from '@/common/crypto';
import { BusinessError } from '@/common/errors/business-error';
import type {
  AuthFeatureAvailableSetting,
  AuthFeatureStatus,
} from '@/database/schema';
import {
  AuthRuntimeRegistry,
  BETTER_AUTH_FEATURE_CATALOG_MAP,
  type BetterAuthFeatureId,
} from '@/modules/auth';
import {
  CONFIG_INVALIDATED_CHANNEL,
  TenantService,
  buildTenantSlugCacheKey,
} from '@/modules/tenant';
import type { UpdateTenantFeatureConfigDto } from '../dto/feature-tier.dto';
import {
  FEATURE_TIER_REPOSITORY_TOKEN,
  type IFeatureTierRepository,
} from '../interfaces/feature-tier-repository.interface';
import { TENANT_FEATURE_CONFIG_CACHE_PREFIX } from './feature-resolution.service';

export interface TenantFeatureConfigView {
  featureId: string;
  featureCode: string;
  name: string;
  category: string;
  status: AuthFeatureStatus;
  allowedInTier: boolean;
  enabled: boolean;
  configuredEnabled: boolean;
  settings: Record<string, string | number | boolean>;
  availableSetting: AuthFeatureAvailableSetting[];
  secretsConfigured: Record<string, boolean>;
}

interface TenantConfigRedisClient {
  del?: (...keys: string[]) => Promise<unknown>;
  publish?: (channel: string, message: string) => Promise<unknown>;
}

@Injectable()
export class TenantFeatureConfigService {
  constructor(
    @Inject(FEATURE_TIER_REPOSITORY_TOKEN)
    private readonly repo: IFeatureTierRepository,
    private readonly cryptoService: CryptoService,
    private readonly tenantService: TenantService,
    @Optional()
    private readonly authRuntimeRegistry?: AuthRuntimeRegistry,
    @Optional()
    @Inject(BETTER_AUTH_REDIS_CLIENT)
    private readonly redisClient?: TenantConfigRedisClient,
  ) {}

  async getTenantFeatureConfigs(
    tenantId: string,
  ): Promise<TenantFeatureConfigView[]> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    const [features, tierFeatureIds, tenantRows] = await Promise.all([
      this.repo.listFeatures(),
      this.repo.getTierFeatureIds(tenant.tierId),
      this.repo.listTenantFeatureConfigs(tenantId),
    ]);

    const allowedSet = new Set(tierFeatureIds);
    const rowByFeatureId = new Map(tenantRows.map((r) => [r.featureId, r]));

    return features.map((feature) => {
      const row = rowByFeatureId.get(feature.id);
      const allowedInTier = allowedSet.has(feature.id);
      const catalogEntry =
        BETTER_AUTH_FEATURE_CATALOG_MAP[feature.code as BetterAuthFeatureId];
      const isActive =
        feature.status === 'active' && (catalogEntry?.available ?? true);

      const secretKeys = (feature.availableSetting ?? [])
        .filter((s) => s.type === 'secret')
        .map((s) => s.key);

      const secretsConfigured: Record<string, boolean> = {};
      for (const key of secretKeys) {
        secretsConfigured[key] = Boolean(row?.secrets?.[key]);
      }
      for (const key of Object.keys(row?.secrets ?? {})) {
        if (!(key in secretsConfigured)) {
          secretsConfigured[key] = Boolean(row?.secrets?.[key]);
        }
      }

      const cleanSettings: Record<string, string | number | boolean> = {
        ...(catalogEntry?.defaultSettings ?? {}),
        ...(row?.settings ?? {}),
      };
      for (const key of secretKeys) {
        delete cleanSettings[key];
      }

      const configuredEnabled =
        row?.enabled ?? catalogEntry?.defaultEnabled ?? false;

      return {
        featureId: feature.id,
        featureCode: feature.code,
        name: feature.name,
        category: feature.category,
        status: feature.status,
        allowedInTier,
        enabled: isActive && allowedInTier ? configuredEnabled : false,
        configuredEnabled,
        settings: cleanSettings,
        availableSetting: feature.availableSetting ?? [],
        secretsConfigured,
      };
    });
  }

  async updateTenantFeatureConfig(
    tenantId: string,
    dto: UpdateTenantFeatureConfigDto,
    actorId?: string,
  ): Promise<TenantFeatureConfigView> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    const feature = await this.repo.findFeatureByIdOrCode(dto.featureCode);
    if (!feature) {
      throw BusinessError.notFound('Feature', dto.featureCode);
    }

    const catalogEntry =
      BETTER_AUTH_FEATURE_CATALOG_MAP[feature.code as BetterAuthFeatureId];
    const isFeatureActive =
      feature.status === 'active' && catalogEntry?.available !== false;
    const tierFeatureIds = await this.repo.getTierFeatureIds(tenant.tierId);
    const isAllowedInTier = tierFeatureIds.includes(feature.id);

    const hasConfigMutation =
      Boolean(dto.settings && Object.keys(dto.settings).length > 0) ||
      Boolean(dto.secrets && Object.keys(dto.secrets).length > 0) ||
      Boolean(dto.clearSecretKeys && dto.clearSecretKeys.length > 0);

    if (dto.enabled || hasConfigMutation) {
      if (!isFeatureActive) {
        throw BusinessError.badRequest(
          `Fitur '${feature.code}' tidak tersedia (status: ${feature.status}).`,
          'FEATURE_UNAVAILABLE',
          { featureCode: feature.code, status: feature.status },
        );
      }

      if (!isAllowedInTier) {
        throw BusinessError.forbidden(
          `Fitur '${feature.code}' tidak termasuk dalam tier '${tenant.tierId}'.`,
          'FEATURE_TIER_LOCKED',
          { featureCode: feature.code, tierId: tenant.tierId },
        );
      }
    }

    const existingRow = await this.repo.findTenantFeatureConfig(
      tenantId,
      feature.id,
    );

    const secretFieldKeys = new Set(
      (feature.availableSetting ?? [])
        .filter((s) => s.type === 'secret')
        .map((s) => s.key),
    );

    const cleanSettings: Record<string, string | number | boolean> = {
      ...(existingRow?.settings ?? {}),
    };
    const incomingSecrets: Record<string, string | null | undefined> = {
      ...(dto.secrets ?? {}),
    };

    if (dto.settings && typeof dto.settings === 'object') {
      for (const [key, value] of Object.entries(dto.settings)) {
        if (secretFieldKeys.has(key)) {
          if (typeof value === 'string' && !(key in incomingSecrets)) {
            incomingSecrets[key] = value;
          }
          continue;
        }
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          cleanSettings[key] = value;
        }
      }
    }

    for (const key of secretFieldKeys) {
      delete cleanSettings[key];
    }

    const mergedSecrets = this.cryptoService.mergeSecrets(
      existingRow?.secrets ?? {},
      incomingSecrets,
      dto.clearSecretKeys,
    );

    const saved = await this.repo.upsertTenantFeatureConfig({
      tenantId,
      featureId: feature.id,
      enabled: dto.enabled,
      settings: cleanSettings,
      secrets: mergedSecrets,
      updatedBy: actorId ?? null,
    });

    const newConfigVersion = await this.repo.bumpTenantConfigVersion(tenantId);

    if (this.redisClient?.del) {
      try {
        await this.redisClient.del(
          `${TENANT_FEATURE_CONFIG_CACHE_PREFIX}${tenantId}`,
        );
        if (tenant.slug) {
          await this.redisClient.del(buildTenantSlugCacheKey(tenant.slug));
        }
      } catch {
        // Best-effort cache invalidation
      }
    } else if (tenant.slug) {
      await this.tenantService.invalidateSlugCache?.(tenant.slug);
    }

    await this.authRuntimeRegistry?.invalidateTenant(
      tenantId,
      newConfigVersion,
    );

    if (this.redisClient?.publish) {
      try {
        await this.redisClient.publish(
          CONFIG_INVALIDATED_CHANNEL,
          JSON.stringify({
            scope: 'tenant',
            tenantId,
            ...(tenant.slug ? { slug: tenant.slug } : {}),
            configVersion: newConfigVersion,
          }),
        );
      } catch {
        // Best-effort pub/sub broadcast
      }
    }

    const secretsConfigured: Record<string, boolean> = {};
    for (const key of secretFieldKeys) {
      secretsConfigured[key] = Boolean(saved.secrets?.[key]);
    }
    for (const key of Object.keys(saved.secrets ?? {})) {
      if (!(key in secretsConfigured)) {
        secretsConfigured[key] = Boolean(saved.secrets?.[key]);
      }
    }

    return {
      featureId: feature.id,
      featureCode: feature.code,
      name: feature.name,
      category: feature.category,
      status: feature.status,
      allowedInTier: isAllowedInTier,
      enabled: isFeatureActive && isAllowedInTier ? saved.enabled : false,
      configuredEnabled: saved.enabled,
      settings: saved.settings,
      availableSetting: feature.availableSetting ?? [],
      secretsConfigured,
    };
  }
}
