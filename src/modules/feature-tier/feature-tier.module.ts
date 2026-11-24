import { Module } from '@nestjs/common';
import { BetterAuthCacheModule } from '@/common/auth/better-auth-cache.module';
import { CryptoModule } from '@/common/crypto';
import { DatabaseModule } from '@/database/database.module';
import { RbacModule } from '@/modules/rbac';
import { TenantModule } from '@/modules/tenant';
import { OperatorFeatureTierController } from './controllers/operator-feature-tier.controller';
import { FEATURE_TIER_REPOSITORY_TOKEN } from './interfaces/feature-tier-repository.interface';
import { FeatureTierRepository } from './repositories/feature-tier.repository';
import { FeatureCatalogService } from './services/feature-catalog.service';
import { FeatureResolutionService } from './services/feature-resolution.service';
import { TenantFeatureConfigService } from './services/tenant-feature-config.service';

@Module({
  imports: [
    DatabaseModule,
    CryptoModule,
    BetterAuthCacheModule,
    TenantModule,
    RbacModule,
  ],
  controllers: [OperatorFeatureTierController],
  providers: [
    {
      provide: FEATURE_TIER_REPOSITORY_TOKEN,
      useClass: FeatureTierRepository,
    },
    FeatureCatalogService,
    FeatureResolutionService,
    {
      provide: 'FEATURE_RESOLUTION_SERVICE',
      useExisting: FeatureResolutionService,
    },
    TenantFeatureConfigService,
  ],
  exports: [
    FEATURE_TIER_REPOSITORY_TOKEN,
    FeatureCatalogService,
    FeatureResolutionService,
    'FEATURE_RESOLUTION_SERVICE',
    TenantFeatureConfigService,
  ],
})
export class FeatureTierModule {}
