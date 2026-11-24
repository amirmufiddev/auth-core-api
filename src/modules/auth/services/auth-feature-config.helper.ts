import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { CryptoService, EncryptedPayload } from '@/common/crypto';
import { BusinessError } from '@/common/errors/business-error';
import * as schema from '@/database/schema';
import type { AuthFeatureAvailableSetting } from '@/database/schema';
import type { AppLoggerService } from '@/logger/logger.service';
import {
  BETTER_AUTH_FEATURE_CATALOG,
  BETTER_AUTH_FEATURE_CATALOG_MAP,
  type BetterAuthFeatureId,
  type FeatureConfigMap,
  getSecretFieldKeys,
} from '../config/feature-catalog';

export interface PlatformFeatureConfigPatch {
  enabled?: boolean;
  settings?: Record<string, unknown>;
  secrets?: Record<string, string | null | undefined>;
  clearSecretKeys?: string[];
}

export function collectSecretFieldKeys(
  code: BetterAuthFeatureId,
  dbAvailableSetting?: AuthFeatureAvailableSetting[] | null,
): Set<string> {
  const keys = new Set<string>(getSecretFieldKeys(code));
  for (const setting of dbAvailableSetting ?? []) {
    if (setting.type === 'secret') {
      keys.add(setting.key);
    }
  }
  return keys;
}

export function stripSecretKeysFromSettings(
  settings: Record<string, unknown> | null | undefined,
  secretKeys: ReadonlySet<string>,
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  if (!settings || typeof settings !== 'object') return clean;

  for (const [key, value] of Object.entries(settings)) {
    if (secretKeys.has(key)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      clean[key] = value;
    }
  }
  return clean;
}

export function splitIncomingFeaturePatch(
  code: BetterAuthFeatureId,
  patch: PlatformFeatureConfigPatch | undefined,
  dbAvailableSetting?: AuthFeatureAvailableSetting[] | null,
): {
  cleanPatch?: { enabled?: boolean; settings?: Record<string, unknown> };
  incomingSecrets: Record<string, string | null | undefined>;
  clearSecretKeys: string[];
  secretKeys: Set<string>;
} {
  const secretKeys = collectSecretFieldKeys(code, dbAvailableSetting);
  const incomingSecrets: Record<string, string | null | undefined> = {
    ...(patch?.secrets ?? {}),
  };
  const clearSecretKeys = Array.isArray(patch?.clearSecretKeys)
    ? patch.clearSecretKeys.filter((k): k is string => typeof k === 'string')
    : [];

  if (!patch) {
    return {
      cleanPatch: undefined,
      incomingSecrets,
      clearSecretKeys,
      secretKeys,
    };
  }

  const cleanSettings: Record<string, unknown> = {};
  if (patch.settings && typeof patch.settings === 'object') {
    for (const [key, value] of Object.entries(patch.settings)) {
      if (secretKeys.has(key)) {
        if (typeof value === 'string' && !(key in incomingSecrets)) {
          incomingSecrets[key] = value;
        }
        continue;
      }
      cleanSettings[key] = value;
    }
  }

  return {
    cleanPatch: {
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(patch.settings ? { settings: cleanSettings } : {}),
    },
    incomingSecrets,
    clearSecretKeys,
    secretKeys,
  };
}

export function mergePlatformFeatureSecrets(
  cryptoService: CryptoService | undefined,
  existing: Record<string, EncryptedPayload> | undefined,
  incoming: Record<string, string | null | undefined>,
  clearSecretKeys: string[],
): Record<string, EncryptedPayload> {
  const hasNonEmptyIncoming = Object.values(incoming).some(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (hasNonEmptyIncoming && !cryptoService) {
    throw BusinessError.badRequest(
      'AUTH_CONFIG_ENCRYPTION_KEY is missing or invalid',
      'ENCRYPTION_KEY_MISSING',
    );
  }
  if (cryptoService) {
    return cryptoService.mergeSecrets(
      existing ?? {},
      incoming,
      clearSecretKeys,
    );
  }
  const next: Record<string, EncryptedPayload> = { ...(existing ?? {}) };
  for (const key of clearSecretKeys) {
    delete next[key];
  }
  return next;
}

export function isKnownCatalogFeatureCode(
  code: string,
): code is BetterAuthFeatureId {
  return Object.prototype.hasOwnProperty.call(
    BETTER_AUTH_FEATURE_CATALOG_MAP,
    code,
  );
}

export function decryptPlatformSecrets(
  cryptoService: CryptoService | undefined,
  currentConfig: FeatureConfigMap,
  currentSecrets: Partial<
    Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>
  >,
  logger: AppLoggerService,
): Partial<Record<BetterAuthFeatureId, Record<string, string>>> {
  if (!cryptoService) return {};
  const result: Partial<Record<BetterAuthFeatureId, Record<string, string>>> =
    {};

  for (const item of BETTER_AUTH_FEATURE_CATALOG) {
    if (!currentConfig[item.id]?.enabled) continue;
    const encryptedMap = currentSecrets[item.id];
    if (!encryptedMap) continue;

    const decryptedForFeature: Record<string, string> = {};
    for (const [key, payload] of Object.entries(encryptedMap)) {
      if (!payload || typeof payload !== 'object') continue;
      try {
        const plain = cryptoService.decryptSecret(payload);
        if (plain.length > 0) {
          decryptedForFeature[key] = plain;
        }
      } catch (error) {
        logger.warn(
          `Gagal mendekripsi secret '${item.id}.${key}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          'AuthFeatureConfigService',
        );
      }
    }
    if (Object.keys(decryptedForFeature).length > 0) {
      result[item.id] = decryptedForFeature;
    }
  }

  return result;
}

type DbExecutor = Pick<NodePgDatabase<typeof schema>, 'select' | 'insert'>;

export async function persistPlatformFeatureConfigRows(params: {
  tx: DbExecutor;
  incoming: Partial<Record<string, PlatformFeatureConfigPatch>>;
  merged: FeatureConfigMap;
  currentSecrets: Partial<
    Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>
  >;
  updatedBy?: string;
  cryptoService?: CryptoService;
}): Promise<
  Partial<Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>>
> {
  const { tx, incoming, merged, currentSecrets, updatedBy, cryptoService } =
    params;
  const featureRows = await tx
    .select({
      id: schema.authFeatures.id,
      code: schema.authFeatures.code,
      availableSetting: schema.authFeatures.availableSetting,
    })
    .from(schema.authFeatures);

  const featureByCode = new Map(featureRows.map((f) => [f.code, f]));
  const existingConfigRows = await tx.select().from(schema.authFeatureConfig);
  const existingByFeatureId = new Map(
    existingConfigRows.map((r) => [r.featureId, r]),
  );
  const nextSecrets: Partial<
    Record<BetterAuthFeatureId, Record<string, EncryptedPayload>>
  > = { ...currentSecrets };

  for (const item of BETTER_AUTH_FEATURE_CATALOG) {
    const dbFeature = featureByCode.get(item.id);
    if (!dbFeature) continue;

    const split = splitIncomingFeaturePatch(
      item.id,
      incoming?.[item.id],
      dbFeature.availableSetting,
    );
    const existingRow = existingByFeatureId.get(dbFeature.id);
    const existingSecrets =
      existingRow?.secrets ?? currentSecrets[item.id] ?? {};

    const mergedSecrets = mergePlatformFeatureSecrets(
      cryptoService,
      existingSecrets,
      split.incomingSecrets,
      split.clearSecretKeys,
    );
    const cleanSettings = stripSecretKeysFromSettings(
      merged[item.id].settings,
      split.secretKeys,
    );
    merged[item.id] = {
      enabled: merged[item.id].enabled,
      settings: cleanSettings,
    };
    if (Object.keys(mergedSecrets).length > 0) {
      nextSecrets[item.id] = mergedSecrets;
    } else {
      delete nextSecrets[item.id];
    }

    await tx
      .insert(schema.authFeatureConfig)
      .values({
        featureId: dbFeature.id,
        enabled: merged[item.id].enabled,
        settings: cleanSettings,
        secrets: mergedSecrets,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.authFeatureConfig.featureId,
        set: {
          enabled: merged[item.id].enabled,
          settings: cleanSettings,
          secrets: mergedSecrets,
          updatedBy: updatedBy ?? null,
          updatedAt: new Date(),
        },
      });
  }

  return nextSecrets;
}
