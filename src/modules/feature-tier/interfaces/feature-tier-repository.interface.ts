import type { EncryptedPayload } from '@/common/crypto';
import type {
  AuthFeature,
  AuthFeatureConfigRow,
  AuthFeatureStatus,
  AuthTier,
  TenantAuthFeatureConfigRow,
} from '@/database/schema';

export const FEATURE_TIER_REPOSITORY_TOKEN = Symbol(
  'FEATURE_TIER_REPOSITORY_TOKEN',
);

export interface TierWithFeatures extends AuthTier {
  featureIds: string[];
  featureCodes: string[];
}

export interface UpsertTenantFeatureConfigInput {
  tenantId: string;
  featureId: string;
  enabled: boolean;
  settings: Record<string, string | number | boolean>;
  secrets: Record<string, EncryptedPayload>;
  updatedBy?: string | null;
}

export interface IFeatureTierRepository {
  listFeatures(): Promise<AuthFeature[]>;
  findFeatureByIdOrCode(idOrCode: string): Promise<AuthFeature | null>;
  updateFeatureStatus(
    featureId: string,
    status: AuthFeatureStatus,
  ): Promise<AuthFeature | null>;

  listTiersWithFeatures(): Promise<TierWithFeatures[]>;
  findTierById(tierId: string): Promise<AuthTier | null>;
  getTierFeatureIds(tierId: string): Promise<string[]>;
  replaceTierFeatures(tierId: string, featureIds: string[]): Promise<void>;

  listPlatformFeatureConfigs(): Promise<AuthFeatureConfigRow[]>;
  listTenantFeatureConfigs(
    tenantId: string,
  ): Promise<TenantAuthFeatureConfigRow[]>;
  findTenantFeatureConfig(
    tenantId: string,
    featureId: string,
  ): Promise<TenantAuthFeatureConfigRow | null>;
  upsertTenantFeatureConfig(
    input: UpsertTenantFeatureConfigInput,
  ): Promise<TenantAuthFeatureConfigRow>;
  bumpTenantConfigVersion(tenantId: string): Promise<number>;
}
