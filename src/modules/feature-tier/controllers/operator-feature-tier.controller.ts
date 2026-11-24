import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePlatformPermission } from '@/modules/rbac';
import {
  UpdateFeatureStatusDto,
  UpdateTierFeaturesDto,
} from '../dto/feature-tier.dto';
import { FeatureCatalogService } from '../services/feature-catalog.service';

@ApiTags('Operator Feature & Tier')
@ApiBearerAuth()
@Controller({ path: 'api/admin', version: VERSION_NEUTRAL })
export class OperatorFeatureTierController {
  constructor(private readonly catalogService: FeatureCatalogService) {}

  @Get('features')
  @RequirePlatformPermission('authConfig:configure')
  @ApiOperation({ summary: 'Daftar seluruh fitur pada katalog Auth Core' })
  async listFeatures() {
    return this.catalogService.listFeatures();
  }

  @Patch('features/:featureId/status')
  @RequirePlatformPermission('authConfig:configure')
  @ApiOperation({
    summary:
      'Ubah status fitur (active/disabled/coming_soon) dan invalidasi catalogVersion secara O(1)',
  })
  async updateFeatureStatus(
    @Param('featureId') featureId: string,
    @Body() body: UpdateFeatureStatusDto,
  ) {
    return this.catalogService.updateFeatureStatus(featureId, body.status);
  }

  @Get('tiers')
  @RequirePlatformPermission('authConfig:configure')
  @ApiOperation({ summary: 'Daftar seluruh tier beserta matriks fiturnya' })
  async listTiers() {
    return this.catalogService.listTiers();
  }

  @Put('tiers/:tierId/features')
  @RequirePlatformPermission('authConfig:configure')
  @ApiOperation({
    summary:
      'Perbarui matriks fitur untuk tier tertentu dan invalidasi catalogVersion secara O(1)',
  })
  async updateTierFeatures(
    @Param('tierId') tierId: string,
    @Body() body: UpdateTierFeaturesDto,
  ) {
    return this.catalogService.updateTierFeatures(tierId, body.features);
  }
}
