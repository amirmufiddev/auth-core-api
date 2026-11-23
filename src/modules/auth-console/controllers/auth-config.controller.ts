import { Body, Controller, Get, Put, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous, Roles, Session } from '@thallesp/nestjs-better-auth';
import { AuthFeatureConfigService } from '@/modules/auth';
import { UpdateAuthConfigDto } from '../dto/auth-console.dto';
import { AuthConsoleService } from '../services/auth-console.service';

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
    private readonly consoleService: AuthConsoleService,
  ) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Ambil status aktif/non-aktif seluruh fitur & plugin Better Auth',
  })
  getConfig() {
    return this.featureConfigService.getPublicConfig();
  }

  @Put()
  @ApiBearerAuth()
  @Roles(['super_admin', 'admin'])
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

    await this.consoleService.recordAudit({
      event: 'config.features_updated',
      category: 'config',
      severity: 'warning',
      actor: session?.user
        ? {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role ?? 'admin',
          }
        : undefined,
      target: 'auth-config',
      metadata: {
        enabledCount: Object.values(updated).filter((f) => f.enabled).length,
      },
    });

    return {
      features: this.featureConfigService.getPublicConfig().features,
      capabilities: this.featureConfigService.getPublicConfig().capabilities,
      syncedAt: new Date().toISOString(),
    };
  }
}
