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
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import { BillingRecordResponseDto } from '@/modules/billing';
import {
  TenantFeatureConfigService,
  UpdateTenantFeatureConfigDto,
} from '@/modules/feature-tier';
import { TenantResponseDto } from '@/modules/tenant';
import {
  CreatePortalOAuthClientDto,
  CreatePortalTenantDto,
  ListPortalBillingQueryDto,
  ListPortalOAuthClientsQueryDto,
  ListPortalTenantsQueryDto,
  ListPortalTenantOrgsQueryDto,
  ListPortalTenantUsersQueryDto,
  ListPortalTenantApiKeysQueryDto,
  PortalBillingSummaryResponseDto,
  PortalTenantApiKeyResponseDto,
  PortalOAuthClientResponseDto,
  CreatePortalTenantApiKeyDto,
  PortalTenantOrgResponseDto,
  PortalTenantUserResponseDto,
  UpdatePortalTenantDto,
} from '../dto/customer-portal.dto';
import { TenantOwnerGuard } from '../guards/tenant-owner.guard';
import { CustomerPortalService } from '../services/customer-portal.service';
import { PortalTenantOrgsService } from '../services/portal-tenant-orgs.service';
import { PortalTenantUsersService } from '../services/portal-tenant-users.service';
import { PortalTenantApiKeysService } from '../services/portal-tenant-api-keys.service';

interface PortalSessionContext {
  user?: {
    id?: string;
    tenantId?: string | null;
    email?: string;
  } | null;
}

@ApiTags('Customer Portal')
@ApiBearerAuth()
@UseGuards(TenantOwnerGuard)
@Controller({ path: 'api/portal/tenants', version: VERSION_NEUTRAL })
export class CustomerPortalController {
  constructor(
    private readonly portalService: CustomerPortalService,
    private readonly portalTenantUsersService: PortalTenantUsersService,
    private readonly portalTenantOrgsService: PortalTenantOrgsService,
    private readonly tenantFeatureConfigService: TenantFeatureConfigService,
    private readonly portalTenantApiKeysService: PortalTenantApiKeysService,
  ) {}

  private extractUserId(session: PortalSessionContext | null): string {
    const userId = session?.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }
    return userId;
  }

  @Get()
  @ApiOperation({ summary: 'Daftar tenant milik pelanggan yang sedang login' })
  async listOwnedTenants(
    @Session() session: PortalSessionContext | null,
    @Query() query: ListPortalTenantsQueryDto,
  ) {
    const userId = this.extractUserId(session);
    const result = await this.portalService.listOwnedTenants(userId, query);

    return {
      items: result.items.map(TenantResponseDto.fromEntity),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Buat tenant baru untuk pelanggan aktif' })
  async createTenant(
    @Session() session: PortalSessionContext | null,
    @Body() body: CreatePortalTenantDto,
  ): Promise<TenantResponseDto> {
    const userId = this.extractUserId(session);
    const created = await this.portalService.createTenant(userId, body);
    return TenantResponseDto.fromEntity(created);
  }

  @Get(':tenantId')
  @ApiOperation({ summary: 'Detail tenant milik pelanggan' })
  async getTenant(
    @Param('tenantId') tenantId: string,
  ): Promise<TenantResponseDto> {
    const tenant = await this.portalService.getTenant(tenantId);
    return TenantResponseDto.fromEntity(tenant);
  }

  @Patch(':tenantId')
  @ApiOperation({
    summary: 'Perbarui nama tenant milik pelanggan (slug bersifat immutable)',
  })
  async updateTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: UpdatePortalTenantDto,
  ): Promise<TenantResponseDto> {
    const updated = await this.portalService.updateTenant(tenantId, body);
    return TenantResponseDto.fromEntity(updated);
  }

  @Get(':tenantId/api-keys')
  @ApiOperation({
    summary:
      'Daftar API Key terikat tenant (WHERE apikey.tenant_id = :tenantId)',
  })
  async listTenantApiKeys(
    @Param('tenantId') tenantId: string,
    @Query() query: ListPortalTenantApiKeysQueryDto,
  ): Promise<{
    items: PortalTenantApiKeyResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.portalTenantApiKeysService.listTenantApiKeys(tenantId, query);
  }

  @Post(':tenantId/api-keys')
  @ApiOperation({
    summary:
      'Buat Tenant API Key (plainApiKey dikembalikan satu kali; memerlukan fitur apiKey aktif di tier tenant)',
  })
  async createTenantApiKey(
    @Param('tenantId') tenantId: string,
    @Session() session: PortalSessionContext | null,
    @Body() body: CreatePortalTenantApiKeyDto,
  ): Promise<PortalTenantApiKeyResponseDto> {
    const userId = this.extractUserId(session);
    return this.portalTenantApiKeysService.createTenantApiKey(
      tenantId,
      userId,
      body,
      session?.user?.email,
    );
  }

  @Delete(':tenantId/api-keys/:keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cabut / hapus Tenant API Key' })
  @ApiParam({ name: 'keyId', description: 'Internal apikey.id' })
  async deleteTenantApiKey(
    @Param('tenantId') tenantId: string,
    @Param('keyId') keyId: string,
  ): Promise<void> {
    await this.portalTenantApiKeysService.deleteTenantApiKey(tenantId, keyId);
  }

  @Get(':tenantId/oauth-clients')
  @ApiOperation({ summary: 'Daftar OAuth client terikat tenant' })
  async listOAuthClients(
    @Param('tenantId') tenantId: string,
    @Query() query: ListPortalOAuthClientsQueryDto,
  ): Promise<{
    items: PortalOAuthClientResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.portalService.listTenantOAuthClients(tenantId, query);
  }

  @Post(':tenantId/oauth-clients')
  @ApiOperation({
    summary:
      'Buat OAuth client terikat tenant (Free tier maksimal 1 client; plainClientSecret dikembalikan 1 kali)',
  })
  async createOAuthClient(
    @Param('tenantId') tenantId: string,
    @Session() session: PortalSessionContext | null,
    @Body() body: CreatePortalOAuthClientDto,
  ): Promise<PortalOAuthClientResponseDto> {
    const userId = this.extractUserId(session);
    return this.portalService.createTenantOAuthClient(tenantId, userId, body);
  }

  @Delete(':tenantId/oauth-clients/:clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus OAuth client milik tenant' })
  @ApiParam({
    name: 'clientId',
    description: 'Internal OAuth client record ID (oauth_client.id)',
  })
  async deleteOAuthClient(
    @Param('tenantId') tenantId: string,
    @Param('clientId') clientId: string,
  ): Promise<void> {
    await this.portalService.deleteTenantOAuthClient(tenantId, clientId);
  }

  @Get(':tenantId/billing')
  @ApiOperation({ summary: 'Ringkasan status dan riwayat billing tenant' })
  async getTenantBilling(
    @Param('tenantId') tenantId: string,
    @Query() query: ListPortalBillingQueryDto,
  ): Promise<PortalBillingSummaryResponseDto> {
    const billing = await this.portalService.getTenantBilling(tenantId, query);

    return {
      tenantId: billing.tenantId,
      tierId: billing.tierId,
      billingStatus: billing.billingStatus,
      items: billing.items.map(BillingRecordResponseDto.fromEntity),
      total: billing.total,
      page: billing.page,
      pageSize: billing.pageSize,
    };
  }

  @Get(':tenantId/users')
  @ApiOperation({
    summary:
      'Daftar user terisolasi milik tenant (WHERE user.tenant_id = :tenantId)',
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
    return this.portalTenantUsersService.listTenantUsers(tenantId, query);
  }

  @Get(':tenantId/organizations')
  @ApiOperation({
    summary:
      'Daftar organization terisolasi milik tenant (WHERE organization.tenant_id = :tenantId)',
  })
  async listTenantOrganizations(
    @Param('tenantId') tenantId: string,
    @Query() query: ListPortalTenantOrgsQueryDto,
  ): Promise<{
    items: PortalTenantOrgResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.portalTenantOrgsService.listTenantOrganizations(
      tenantId,
      query,
    );
  }

  @Get(':tenantId/features')
  @ApiOperation({
    summary:
      'Daftar konfigurasi fitur tenant (hanya mengembalikan secretsConfigured boolean, tanpa plaintext/ciphertext)',
  })
  async getTenantFeatures(@Param('tenantId') tenantId: string) {
    return this.tenantFeatureConfigService.getTenantFeatureConfigs(tenantId);
  }

  @Put(':tenantId/features')
  @ApiOperation({
    summary:
      'Perbarui konfigurasi fitur & secret terenkripsi milik tenant (validasi tier & status fitur)',
  })
  async updateTenantFeature(
    @Param('tenantId') tenantId: string,
    @Session() session: PortalSessionContext | null,
    @Body() body: UpdateTenantFeatureConfigDto,
  ) {
    const userId = this.extractUserId(session);
    return this.tenantFeatureConfigService.updateTenantFeatureConfig(
      tenantId,
      body,
      userId,
    );
  }
}
