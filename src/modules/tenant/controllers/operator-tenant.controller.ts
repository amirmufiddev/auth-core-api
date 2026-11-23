import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePlatformPermission } from '@/modules/rbac';
import {
  ChangeTenantTierDto,
  CreateTenantDto,
  ListTenantsQueryDto,
  TenantResponseDto,
  UpdateTenantDto,
} from '../dto/tenant.dto';
import { TenantService } from '../services/tenant.service';

@ApiTags('Operator / Tenants')
@ApiBearerAuth()
@Controller({ path: 'api/admin/tenants', version: VERSION_NEUTRAL })
export class OperatorTenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @RequirePlatformPermission('organization:read')
  @ApiOperation({ summary: 'Daftar tenant multi-tenant terpaginasi' })
  async listTenants(@Query() query: ListTenantsQueryDto) {
    const result = await this.tenantService.listTenants({
      page: query.page ?? 0,
      pageSize: query.pageSize ?? 10,
      search: query.search,
      status: query.status,
      tierId: query.tierId,
    });

    return {
      items: result.items.map(TenantResponseDto.fromEntity),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  @RequirePlatformPermission('organization:read')
  @ApiOperation({ summary: 'Detail tenant berdasarkan ID' })
  async getTenant(@Param('id') id: string): Promise<TenantResponseDto> {
    const tenant = await this.tenantService.getTenantById(id);
    return TenantResponseDto.fromEntity(tenant);
  }

  @Post()
  @RequirePlatformPermission('organization:create')
  @ApiOperation({ summary: 'Buat tenant baru dengan validasi reserved slug' })
  async createTenant(
    @Body() body: CreateTenantDto,
  ): Promise<TenantResponseDto> {
    const created = await this.tenantService.createTenant(body);
    return TenantResponseDto.fromEntity(created);
  }

  @Patch(':id')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Perbarui tenant (slug bersifat immutable)' })
  async updateTenant(
    @Param('id') id: string,
    @Body() body: UpdateTenantDto,
  ): Promise<TenantResponseDto> {
    const updated = await this.tenantService.updateTenant(id, body);
    return TenantResponseDto.fromEntity(updated);
  }

  @Patch(':id/tier')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Ubah tier tenant dan naikkan configVersion' })
  async changeTier(
    @Param('id') id: string,
    @Body() body: ChangeTenantTierDto,
  ): Promise<TenantResponseDto> {
    const updated = await this.tenantService.changeTier(id, body.tierId);
    return TenantResponseDto.fromEntity(updated);
  }

  @Post(':id/suspend')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Tangguhkan tenant dan invalidasi slug cache' })
  async suspendTenant(@Param('id') id: string): Promise<TenantResponseDto> {
    const updated = await this.tenantService.suspendTenant(id);
    return TenantResponseDto.fromEntity(updated);
  }

  @Post(':id/activate')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Aktifkan kembali tenant' })
  async activateTenant(@Param('id') id: string): Promise<TenantResponseDto> {
    const updated = await this.tenantService.activateTenant(id);
    return TenantResponseDto.fromEntity(updated);
  }
}
