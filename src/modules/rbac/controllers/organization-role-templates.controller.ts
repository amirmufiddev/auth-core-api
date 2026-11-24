import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UpsertOrganizationRoleTemplateDto } from '../dto/organization-role-template.dto';
import { TenantUserGuard } from '../guards/tenant-user.guard';
import type { TenantUserRequest } from '../guards/tenant-user.guard';
import { OrganizationRoleTemplateService } from '../services/organization-role-template.service';

@ApiTags('RBAC')
@ApiBearerAuth()
@UseGuards(TenantUserGuard)
@Controller('rbac/role-templates')
export class OrganizationRoleTemplatesController {
  constructor(
    private readonly templateService: OrganizationRoleTemplateService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Daftar template role milik tenant',
  })
  list(@Req() req: TenantUserRequest) {
    return this.templateService.list(req.tenantUser!.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Tambah template role tenant' })
  create(
    @Req() req: TenantUserRequest,
    @Body() body: UpsertOrganizationRoleTemplateDto,
  ) {
    return this.templateService.create(req.tenantUser!.tenantId, body);
  }

  @Patch(':roleName')
  @ApiOperation({ summary: 'Ubah template role tenant' })
  update(
    @Req() req: TenantUserRequest,
    @Param('roleName') roleName: string,
    @Body() body: UpsertOrganizationRoleTemplateDto,
  ) {
    return this.templateService.update(req.tenantUser!.tenantId, roleName, {
      ...body,
      roleName,
    });
  }

  @Delete(':roleName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus template role tenant selain owner' })
  remove(@Req() req: TenantUserRequest, @Param('roleName') roleName: string) {
    return this.templateService.remove(req.tenantUser!.tenantId, roleName);
  }
}
