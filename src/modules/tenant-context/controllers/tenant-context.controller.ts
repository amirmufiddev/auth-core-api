import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type {
  ListOrganizationMembersQueryDto,
  ListTenantOrganizationsQueryDto,
  PosSessionContextDto,
  TenantContextRequest,
} from '../dto/tenant-context.dto';
import { TenantApiOrBearerGuard } from '../guards/tenant-api-or-bearer.guard';
import { TenantContextService } from '../services/tenant-context.service';

@AllowAnonymous()
@UseGuards(TenantApiOrBearerGuard)
@Controller({ path: 'api/context', version: VERSION_NEUTRAL })
export class TenantContextController {
  constructor(private readonly tenantContextService: TenantContextService) {}

  @Get('session')
  async getSessionContext(
    @Req() req: TenantContextRequest,
    @Query('userId') queryUserId?: string,
    @Query('organizationId') queryOrganizationId?: string,
  ): Promise<PosSessionContextDto> {
    const authCtx = req.tenantAuthContext!;
    const targetUserId =
      authCtx.authType === 'api_key' && queryUserId?.trim()
        ? queryUserId.trim()
        : authCtx.userId;
    const targetOrgId =
      queryOrganizationId?.trim() || authCtx.activeOrganizationId || null;

    return this.tenantContextService.getSessionContext({
      tenantId: authCtx.tenantId,
      userId: targetUserId,
      activeOrganizationId: targetOrgId,
    });
  }

  @Get('organizations')
  async listOrganizations(
    @Req() req: TenantContextRequest,
    @Query() query: ListTenantOrganizationsQueryDto,
  ) {
    const authCtx = req.tenantAuthContext!;
    return this.tenantContextService.listOrganizations({
      tenantId: authCtx.tenantId,
      userId: authCtx.authType === 'bearer' ? authCtx.userId : undefined,
      query,
    });
  }

  @Get('organizations/:organizationId')
  async getOrganization(
    @Req() req: TenantContextRequest,
    @Param('organizationId') organizationId: string,
  ) {
    const authCtx = req.tenantAuthContext!;
    return this.tenantContextService.getOrganization({
      tenantId: authCtx.tenantId,
      organizationId,
      userId: authCtx.authType === 'bearer' ? authCtx.userId : undefined,
    });
  }

  @Get('organizations/:organizationId/members')
  async listOrganizationMembers(
    @Req() req: TenantContextRequest,
    @Param('organizationId') organizationId: string,
    @Query() query: ListOrganizationMembersQueryDto,
  ) {
    const authCtx = req.tenantAuthContext!;
    return this.tenantContextService.listOrganizationMembers({
      tenantId: authCtx.tenantId,
      organizationId,
      userId: authCtx.authType === 'bearer' ? authCtx.userId : undefined,
      query,
    });
  }
}
