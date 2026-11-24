import { Body, Controller, Get, Put, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
import { AuthFeatureConfigService } from '@/modules/auth';
import { FeatureResolutionService } from '@/modules/feature-tier';
import { RequirePlatformPermission } from '@/modules/rbac';
import { TenantContextStorage } from '@/modules/tenant';
import { UpdateAuthConfigDto } from '../dto/auth-config.dto';
import { PlatformAuditService } from '../services/platform-audit.service';

interface SessionPayload {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

@ApiTags('Auth Config')
@Controller({ path: 'api/auth-config', version: VERSION_NEUTRAL })
export class AuthConfigController {
  constructor(
    private readonly featureConfigService: AuthFeatureConfigService,
    private readonly featureResolutionService: FeatureResolutionService,
    private readonly auditService: PlatformAuditService,
  ) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Ambil status aktif/non-aktif seluruh fitur & plugin Better Auth',
  })
  getConfig() {
    const ctx = TenantContextStorage.get();
    if (ctx?.tenantId && ctx.source !== 'platform') {
      return this.featureResolutionService.getPublicCapabilitiesForTenant(
        ctx.tenantId,
      );
    }
    return this.featureConfigService.getPublicConfig();
  }

  @Put()
  @ApiBearerAuth()
  @RequirePlatformPermission('authFeature:configure')
  @ApiOperation({
    summary:
      'Simpan konfigurasi runtime fitur Better Auth & reload Better Auth instance',
  })
  async updateConfig(
    @Body() body: UpdateAuthConfigDto,
    @Session() session: SessionPayload | null,
  ) {
    const actorEmail = session?.user?.email;
    const updated = await this.featureConfigService.updateConfig(
      body.features,
      actorEmail,
    );

    await this.auditService.recordAudit({
      event: 'config.features_updated',
      category: 'config',
      severity: 'warning',
      actor: session?.user
        ? {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role ?? 'user',
          }
        : undefined,
      target: 'auth-config',
      metadata: {
        enabledCount: Object.values(updated).filter((f) => f.enabled).length,
      },
    });

    const publicConfig = this.featureConfigService.getPublicConfig();
    return {
      features: publicConfig.features,
      capabilities: publicConfig.capabilities,
      syncedAt: new Date().toISOString(),
    };
  }
}
