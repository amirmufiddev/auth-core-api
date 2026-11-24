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
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TenantUserGuard } from '../guards/tenant-user.guard';
import type { TenantUserRequest } from '../guards/tenant-user.guard';
import {
  PermissionsResponseDto,
  PermissionCodesResponseDto,
} from '../dto/permission.dto';
import { RbacPermissionService } from '../services/rbac-permission.service';
import { CreateRbacPermissionDto } from '../dto/create-rbac-permission.dto';
import { UpdateRbacPermissionDto } from '../dto/update-rbac-permission.dto';
import { RbacPermissionResponseDto } from '../dto/rbac-permission-response.dto';

@ApiTags('RBAC')
@ApiBearerAuth()
@UseGuards(TenantUserGuard)
@Controller('rbac/permissions')
export class PermissionsController {
  constructor(private readonly rbacPermissionService: RbacPermissionService) {}

  @Get()
  @ApiOperation({ summary: 'Katalog permission organisasi milik tenant' })
  @ApiResponse({ status: 200, type: PermissionsResponseDto })
  async getPermissions(
    @Req() req: TenantUserRequest,
  ): Promise<PermissionsResponseDto> {
    return this.rbacPermissionService.getCatalog(req.tenantUser!.tenantId);
  }

  @Get('codes')
  @ApiOperation({ summary: 'Daftar flat kode permission tenant' })
  @ApiResponse({ status: 200, type: PermissionCodesResponseDto })
  async getPermissionCodes(
    @Req() req: TenantUserRequest,
  ): Promise<PermissionCodesResponseDto> {
    const codes = await this.rbacPermissionService.getPermissionCodes(
      req.tenantUser!.tenantId,
    );
    return { codes };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail satu permission tenant' })
  @ApiResponse({ status: 200, type: RbacPermissionResponseDto })
  async getById(
    @Req() req: TenantUserRequest,
    @Param('id') id: string,
  ): Promise<RbacPermissionResponseDto> {
    const row = await this.rbacPermissionService.getById(
      req.tenantUser!.tenantId,
      id,
    );
    return RbacPermissionResponseDto.fromEntity(row);
  }

  @Post()
  @ApiOperation({
    summary: 'Tambah permission ke katalog tenant',
    description:
      'Permission baru di Better Auth statement aktif setelah restart aplikasi.',
  })
  @ApiResponse({ status: 201, type: RbacPermissionResponseDto })
  async create(
    @Req() req: TenantUserRequest,
    @Body() body: CreateRbacPermissionDto,
  ): Promise<RbacPermissionResponseDto> {
    const row = await this.rbacPermissionService.create(
      req.tenantUser!.tenantId,
      body,
    );
    return RbacPermissionResponseDto.fromEntity(row);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Perbarui metadata permission (label/deskripsi)' })
  @ApiResponse({ status: 200, type: RbacPermissionResponseDto })
  async update(
    @Req() req: TenantUserRequest,
    @Param('id') id: string,
    @Body() body: UpdateRbacPermissionDto,
  ): Promise<RbacPermissionResponseDto> {
    const row = await this.rbacPermissionService.update(
      req.tenantUser!.tenantId,
      id,
      body,
    );
    return RbacPermissionResponseDto.fromEntity(row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete permission dari katalog tenant' })
  @ApiResponse({ status: 204 })
  async remove(
    @Req() req: TenantUserRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.rbacPermissionService.remove(req.tenantUser!.tenantId, id);
  }
}
