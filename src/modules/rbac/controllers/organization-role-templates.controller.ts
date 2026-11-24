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
import { toOrganizationRoleTemplateResponse } from '../utils/organization-role-template.mapper';

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
  async list(@Req() req: TenantUserRequest) {
    const rows = await this.templateService.list(req.tenantUser!.tenantId);
    return rows.map(toOrganizationRoleTemplateResponse);
  }

  @Post()
  @ApiOperation({ summary: 'Tambah template role tenant' })
  async create(
    @Req() req: TenantUserRequest,
    @Body() body: UpsertOrganizationRoleTemplateDto,
  ) {
    const created = await this.templateService.create(
      req.tenantUser!.tenantId,
      body,
    );
    return toOrganizationRoleTemplateResponse(created);
  }

  @Patch(':roleName')
  @ApiOperation({ summary: 'Ubah template role tenant' })
  async update(
    @Req() req: TenantUserRequest,
    @Param('roleName') roleName: string,
    @Body() body: UpsertOrganizationRoleTemplateDto,
  ) {
    const updated = await this.templateService.update(
      req.tenantUser!.tenantId,
      roleName,
      {
        ...body,
        roleName,
      },
    );
    return toOrganizationRoleTemplateResponse(updated);
  }

  @Delete(':roleName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus template role tenant selain owner' })
  remove(@Req() req: TenantUserRequest, @Param('roleName') roleName: string) {
    return this.templateService.remove(req.tenantUser!.tenantId, roleName);
  }
}
