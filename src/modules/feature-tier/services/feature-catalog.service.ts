import { Inject, Injectable, Optional } from '@nestjs/common';
import { BusinessError } from '@/common/errors/business-error';
import type { AuthFeature, AuthFeatureStatus } from '@/database/schema';
import { AuthRuntimeRegistry } from '@/modules/auth';
import {
  FEATURE_TIER_REPOSITORY_TOKEN,
  type IFeatureTierRepository,
  type TierWithFeatures,
} from '../interfaces/feature-tier-repository.interface';

@Injectable()
export class FeatureCatalogService {
  constructor(
    @Inject(FEATURE_TIER_REPOSITORY_TOKEN)
    private readonly repo: IFeatureTierRepository,
    @Optional()
    private readonly authRuntimeRegistry?: AuthRuntimeRegistry,
  ) {}

  async listFeatures(): Promise<AuthFeature[]> {
    return this.repo.listFeatures();
  }

  async updateFeatureStatus(
    featureIdOrCode: string,
    status: AuthFeatureStatus,
  ): Promise<{ feature: AuthFeature; catalogVersion: number }> {
    const existing = await this.repo.findFeatureByIdOrCode(featureIdOrCode);
    if (!existing) {
      throw BusinessError.notFound('Feature', featureIdOrCode);
    }

    const updated = await this.repo.updateFeatureStatus(existing.id, status);
    if (!updated) {
      throw BusinessError.notFound('Feature', featureIdOrCode);
    }

    const catalogVersion =
      (await this.authRuntimeRegistry?.invalidateCatalog()) ?? 0;

    return { feature: updated, catalogVersion };
  }

  async listTiers(): Promise<TierWithFeatures[]> {
    return this.repo.listTiersWithFeatures();
  }

  async updateTierFeatures(
    tierId: string,
    featureIdsOrCodes: string[],
  ): Promise<{ tierId: string; featureIds: string[]; catalogVersion: number }> {
    const tier = await this.repo.findTierById(tierId);
    if (!tier) {
      throw BusinessError.notFound('Tier', tierId);
    }

    const allFeatures = await this.repo.listFeatures();
    const byId = new Map(allFeatures.map((f) => [f.id, f]));
    const byCode = new Map(allFeatures.map((f) => [f.code, f]));

    const resolvedIds = new Set<string>();
    for (const item of featureIdsOrCodes) {
      const found = byId.get(item) ?? byCode.get(item);
      if (!found) {
        throw BusinessError.badRequest(
          `Feature '${item}' tidak ditemukan di katalog.`,
          'FEATURE_NOT_FOUND',
          { feature: item },
        );
      }
      resolvedIds.add(found.id);
    }

    const featureIds = Array.from(resolvedIds);
    await this.repo.replaceTierFeatures(tierId, featureIds);

    const catalogVersion =
      (await this.authRuntimeRegistry?.invalidateCatalog()) ?? 0;

    return { tierId, featureIds, catalogVersion };
  }
}
