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
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateRbacPermissionDto } from '@/modules/rbac/dto/create-rbac-permission.dto';
import { OrganizationRoleResponseDto, UpsertOrganizationRoleDto } from '@/modules/rbac/dto/organization-role.dto';
import { UpsertOrganizationRoleTemplateDto } from '@/modules/rbac/dto/organization-role-template.dto';
import { PermissionsResponseDto } from '@/modules/rbac/dto/permission.dto';
import { RbacPermissionResponseDto } from '@/modules/rbac/dto/rbac-permission-response.dto';
import { UpdateRbacPermissionDto } from '@/modules/rbac/dto/update-rbac-permission.dto';
import { OrganizationRoleService } from '@/modules/rbac/services/organization-role.service';
import { OrganizationRoleTemplateService } from '@/modules/rbac/services/organization-role-template.service';
import { RbacPermissionService } from '@/modules/rbac/services/rbac-permission.service';
import { toOrganizationRoleTemplateResponse } from '@/modules/rbac/utils/organization-role-template.mapper';
import { TenantOwnerGuard } from '../guards/tenant-owner.guard';

@ApiTags('Customer Portal')
@ApiBearerAuth()
@UseGuards(TenantOwnerGuard)
@Controller({ path: 'api/portal/tenants', version: VERSION_NEUTRAL })
export class PortalOrganizationRbacController {
  constructor(
    private readonly permissionService: RbacPermissionService,
    private readonly templateService: OrganizationRoleTemplateService,
    private readonly organizationRoleService: OrganizationRoleService,
  ) {}

  @Get(':tenantId/permissions')
  @ApiOperation({ summary: 'Katalog permission organisasi milik tenant' })
  async listPermissions(
    @Param('tenantId') tenantId: string,
  ): Promise<PermissionsResponseDto> {
    return this.permissionService.getCatalog(tenantId);
  }

  @Post(':tenantId/permissions')
  @ApiOperation({
    summary: 'Tambah permission organisasi. Statement Better Auth aktif setelah restart.',
  })
  async createPermission(
    @Param('tenantId') tenantId: string,
    @Body() body: CreateRbacPermissionDto,
  ): Promise<RbacPermissionResponseDto> {
    const row = await this.permissionService.create(tenantId, body);
    return RbacPermissionResponseDto.fromEntity(row);
  }

  @Patch(':tenantId/permissions/:permissionId')
  @ApiOperation({ summary: 'Ubah label permission organisasi' })
  async updatePermission(
    @Param('tenantId') tenantId: string,
    @Param('permissionId') permissionId: string,
    @Body() body: UpdateRbacPermissionDto,
  ): Promise<RbacPermissionResponseDto> {
    const row = await this.permissionService.update(
      tenantId,
      permissionId,
      body,
    );
    return RbacPermissionResponseDto.fromEntity(row);
  }

  @Delete(':tenantId/permissions/:permissionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus permission dari katalog tenant' })
  async removePermission(
    @Param('tenantId') tenantId: string,
    @Param('permissionId') permissionId: string,
  ): Promise<void> {
    await this.permissionService.remove(tenantId, permissionId);
  }

  @Get(':tenantId/role-templates')
  @ApiOperation({ summary: 'Template role yang disalin ke organisasi baru' })
  async listTemplates(@Param('tenantId') tenantId: string) {
    const rows = await this.templateService.list(tenantId);
    return rows.map(toOrganizationRoleTemplateResponse);
  }

  @Post(':tenantId/role-templates')
  @ApiOperation({ summary: 'Tambah template role tenant' })
  async createTemplate(
    @Param('tenantId') tenantId: string,
    @Body() body: UpsertOrganizationRoleTemplateDto,
  ) {
    const created = await this.templateService.create(tenantId, body);
    return toOrganizationRoleTemplateResponse(created);
  }

  @Patch(':tenantId/role-templates/:roleName')
  @ApiOperation({ summary: 'Ubah template role tenant' })
  async updateTemplate(
    @Param('tenantId') tenantId: string,
    @Param('roleName') roleName: string,
    @Body() body: UpsertOrganizationRoleTemplateDto,
  ) {
    const updated = await this.templateService.update(tenantId, roleName, {
      ...body,
      roleName,
    });
    return toOrganizationRoleTemplateResponse(updated);
  }

  @Delete(':tenantId/role-templates/:roleName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus template role selain owner' })
  async removeTemplate(
    @Param('tenantId') tenantId: string,
    @Param('roleName') roleName: string,
  ): Promise<void> {
    await this.templateService.remove(tenantId, roleName);
  }

  @Get(':tenantId/organizations/:organizationId/roles')
  @ApiOperation({ summary: 'Role yang berlaku di satu organisasi' })
  async listRoles(
    @Param('tenantId') tenantId: string,
    @Param('organizationId') organizationId: string,
  ): Promise<OrganizationRoleResponseDto[]> {
    const roles = await this.organizationRoleService.listForTenant(
      tenantId,
      organizationId,
    );
    return roles.map(OrganizationRoleResponseDto.fromEntity);
  }

  @Post(':tenantId/organizations/:organizationId/roles')
  @ApiOperation({ summary: 'Buat role pada organisasi di dalam tenant' })
  async createRole(
    @Param('tenantId') tenantId: string,
    @Param('organizationId') organizationId: string,
    @Body() body: UpsertOrganizationRoleDto,
  ): Promise<OrganizationRoleResponseDto> {
    const created = await this.organizationRoleService.createForTenant(
      tenantId,
      organizationId,
      body,
    );
    return OrganizationRoleResponseDto.fromEntity(created);
  }

  @Patch(':tenantId/organizations/:organizationId/roles/:roleId')
  @ApiOperation({ summary: 'Ubah role organisasi selain owner' })
  async updateRole(
    @Param('tenantId') tenantId: string,
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
    @Body() body: UpsertOrganizationRoleDto,
  ): Promise<OrganizationRoleResponseDto> {
    const updated = await this.organizationRoleService.updateForTenant(
      tenantId,
      organizationId,
      roleId,
      body,
    );
    return OrganizationRoleResponseDto.fromEntity(updated);
  }

  @Delete(':tenantId/organizations/:organizationId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus role organisasi selain owner' })
  async removeRole(
    @Param('tenantId') tenantId: string,
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    await this.organizationRoleService.removeForTenant(
      tenantId,
      organizationId,
      roleId,
    );
  }
}
