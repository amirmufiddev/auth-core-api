import {
  Controller,
  Get,
  Param,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePlatformPermission } from '@/modules/rbac';
import { TenantService } from '@/modules/tenant';
import {
  ListPortalTenantUsersQueryDto,
  PortalTenantUserResponseDto,
} from '../dto/customer-portal.dto';
import { PortalTenantUsersService } from '../services/portal-tenant-users.service';

@ApiTags('Operator / Tenants')
@ApiBearerAuth()
@Controller({ path: 'api/admin/tenants', version: VERSION_NEUTRAL })
export class OperatorTenantUsersController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly portalTenantUsersService: PortalTenantUsersService,
  ) {}

  @Get(':tenantId/users')
  @RequirePlatformPermission('user:read')
  @ApiOperation({
    summary: 'Daftar user terisolasi milik tenant untuk operator platform',
  })
  async listTenantUsers(
    @Param('tenantId') tenantId: string,
    @Query() query: ListPortalTenantUsersQueryDto,
  ): Promise<{
    items: PortalTenantUserResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    await this.tenantService.getTenantById(tenantId);
    return this.portalTenantUsersService.listTenantUsers(tenantId, query);
  }
}
