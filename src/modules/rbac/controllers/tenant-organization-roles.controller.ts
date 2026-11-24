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
import { OrganizationRoleResponseDto, UpsertOrganizationRoleDto } from '../dto/organization-role.dto';
import { TenantUserGuard } from '../guards/tenant-user.guard';
import type { TenantUserRequest } from '../guards/tenant-user.guard';
import { OrganizationRoleService } from '../services/organization-role.service';

@ApiTags('RBAC')
@ApiBearerAuth()
@UseGuards(TenantUserGuard)
@Controller('rbac/organizations/:organizationId/roles')
export class TenantOrganizationRolesController {
  constructor(
    private readonly organizationRoleService: OrganizationRoleService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Daftar role sebuah organisasi di tenant user yang login',
  })
  async list(
    @Req() req: TenantUserRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<OrganizationRoleResponseDto[]> {
    const roles = await this.organizationRoleService.listForTenant(
      req.tenantUser!.tenantId,
      organizationId,
    );
    return roles.map(OrganizationRoleResponseDto.fromEntity);
  }

  @Post()
  @ApiOperation({ summary: 'Buat role organisasi untuk tenant user' })
  async create(
    @Req() req: TenantUserRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: UpsertOrganizationRoleDto,
  ): Promise<OrganizationRoleResponseDto> {
    const created = await this.organizationRoleService.createForTenant(
      req.tenantUser!.tenantId,
      organizationId,
      body,
    );
    return OrganizationRoleResponseDto.fromEntity(created);
  }

  @Patch(':roleId')
  @ApiOperation({ summary: 'Ubah role organisasi untuk tenant user' })
  async update(
    @Req() req: TenantUserRequest,
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
    @Body() body: UpsertOrganizationRoleDto,
  ): Promise<OrganizationRoleResponseDto> {
    const updated = await this.organizationRoleService.updateForTenant(
      req.tenantUser!.tenantId,
      organizationId,
      roleId,
      body,
    );
    return OrganizationRoleResponseDto.fromEntity(updated);
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Hapus role organisasi selain owner, untuk tenant user',
  })
  async remove(
    @Req() req: TenantUserRequest,
    @Param('organizationId') organizationId: string,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    await this.organizationRoleService.removeForTenant(
      req.tenantUser!.tenantId,
      organizationId,
      roleId,
    );
  }
}
