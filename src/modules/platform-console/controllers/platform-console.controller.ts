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
  Query,
  UnauthorizedException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import { RequirePlatformPermission } from '@/modules/rbac';
import {
  normalizeCursorPagination,
  normalizePagination,
} from '../dto/pagination.util';
import {
  BanConsoleUserDto,
  CreateApiKeyDto,
  CreateConsoleOrgDto,
  CreateConsoleRoleDto,
  CreateConsoleUserDto,
  CreateOAuthClientDto,
  CreateSsoProviderDto,
  InviteOrgMemberDto,
  ToggleApiKeyDto,
  UpdateConsoleOrgDto,
  UpdateConsoleRoleDto,
  UpdateConsoleUserDto,
  UpdateOrgMemberRoleDto,
} from '../dto/platform-console.dto';
import type { ConsoleActor } from '../interfaces';
import { PlatformApiKeysService } from '../services/platform-api-keys.service';
import { PlatformAuditService } from '../services/platform-audit.service';
import { PlatformMetricsService } from '../services/platform-metrics.service';
import { PlatformOAuthSsoService } from '../services/platform-oauth-sso.service';
import { PlatformOrganizationsService } from '../services/platform-organizations.service';
import { PlatformRolesService } from '../services/platform-roles.service';
import { PlatformSessionsService } from '../services/platform-sessions.service';
import { PLATFORM_PERMISSION_CATALOG } from '../constants/platform-permissions.catalog';
import { PlatformUsersService } from '../services/platform-users.service';

interface AuthSessionContext {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

@ApiTags('Auth Core Console')
@ApiBearerAuth()
@Controller({ path: 'api/authcore', version: VERSION_NEUTRAL })
export class PlatformConsoleController {
  constructor(
    private readonly usersService: PlatformUsersService,
    private readonly rolesService: PlatformRolesService,
    private readonly organizationsService: PlatformOrganizationsService,
    private readonly sessionsService: PlatformSessionsService,
    private readonly apiKeysService: PlatformApiKeysService,
    private readonly oauthSsoService: PlatformOAuthSsoService,
    private readonly auditService: PlatformAuditService,
    private readonly metricsService: PlatformMetricsService,
  ) {}

  private extractActor(session: AuthSessionContext | null): ConsoleActor {
    if (!session?.user) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }
    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role ?? 'user',
    };
  }

  @Get('me')
  @ApiOperation({
    summary: 'Profil lengkap user aktif beserta passkey & provider',
  })
  async getMe(@Session() session: AuthSessionContext | null) {
    return this.usersService.getMe(this.extractActor(session).id);
  }

  @Get('permissions')
  @RequirePlatformPermission('role:read')
  @ApiOperation({ summary: 'Katalog permission platform (statis)' })
  getPlatformPermissions() {
    return { modules: PLATFORM_PERMISSION_CATALOG };
  }

  @Get('metrics')
  @RequirePlatformPermission('user:read')
  @ApiOperation({ summary: 'KPI & metrik ringkas Auth Core' })
  async getMetrics() {
    return this.metricsService.getDashboardMetrics();
  }

  @Get('users')
  @RequirePlatformPermission('user:read')
  @ApiOperation({ summary: 'Daftar user terpaginasi (platform atau semua tenant)' })
  async listUsers(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('userScope') userScope?: 'platform' | 'all',
    @Query('scope') legacyScope?: string,
  ) {
    const paging = normalizePagination(Number(page), Number(pageSize));
    const includeAllTenants =
      userScope === 'all' || legacyScope === 'all';
    return this.usersService.listUsers({
      page: paging.page,
      pageSize: paging.pageSize,
      search,
      role,
      status,
      sortBy,
      sortDir,
      scope: includeAllTenants ? 'all' : 'platform',
    });
  }

  @Post('users')
  @RequirePlatformPermission('staff:create')
  @ApiOperation({ summary: 'Buat user platform baru dari konsol admin' })
  async createUser(
    @Body() body: CreateConsoleUserDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.usersService.createUser(body, this.extractActor(session));
  }

  @Patch('users/:id')
  @RequirePlatformPermission('staff:update')
  @ApiOperation({ summary: 'Perbarui data user platform' })
  async updateUser(
    @Param('id') id: string,
    @Body() body: UpdateConsoleUserDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.usersService.updateUser(id, body, this.extractActor(session));
  }

  @Post('users/:id/ban')
  @RequirePlatformPermission('staff:ban')
  @ApiOperation({ summary: 'Ban atau unban user platform' })
  async banUser(
    @Param('id') id: string,
    @Body() body: BanConsoleUserDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.usersService.banOrUnbanUser(
      id,
      body,
      this.extractActor(session),
    );
  }

  @Delete('users/:id')
  @RequirePlatformPermission('staff:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus user platform permanen' })
  async deleteUser(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.usersService.deleteUser(id, this.extractActor(session));
  }

  @Get('roles')
  @RequirePlatformPermission('role:read')
  @ApiOperation({ summary: 'Daftar role RBAC Auth Core' })
  async listRoles() {
    return this.rolesService.listRoles();
  }

  @Post('roles')
  @RequirePlatformPermission('role:create')
  @ApiOperation({ summary: 'Buat role RBAC baru' })
  async createRole(
    @Body() body: CreateConsoleRoleDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.rolesService.createRole(body, this.extractActor(session));
  }

  @Patch('roles/:id')
  @RequirePlatformPermission('role:update')
  @ApiOperation({ summary: 'Perbarui matriks permission role' })
  async updateRole(
    @Param('id') id: string,
    @Body() body: UpdateConsoleRoleDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.rolesService.updateRole(id, body, this.extractActor(session));
  }

  @Delete('roles/:id')
  @RequirePlatformPermission('role:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus role kustom' })
  async deleteRole(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.rolesService.deleteRole(id, this.extractActor(session));
  }

  @Get('organizations')
  @RequirePlatformPermission('organization:read')
  @ApiOperation({ summary: 'Daftar organisasi multi-tenant' })
  async listOrganizations(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    const paging = normalizePagination(Number(page), Number(pageSize));
    return this.organizationsService.listOrganizations({
      page: paging.page,
      pageSize: paging.pageSize,
      search,
    });
  }

  @Post('organizations')
  @RequirePlatformPermission('organization:create')
  @ApiOperation({ summary: 'Buat organisasi baru' })
  async createOrganization(
    @Body() body: CreateConsoleOrgDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.organizationsService.createOrganization(
      body,
      this.extractActor(session),
    );
  }

  @Patch('organizations/:id')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Perbarui organisasi' })
  async updateOrganization(
    @Param('id') id: string,
    @Body() body: UpdateConsoleOrgDto,
  ) {
    return this.organizationsService.updateOrganization(id, body);
  }

  @Delete('organizations/:id')
  @RequirePlatformPermission('organization:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus organisasi' })
  async deleteOrganization(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.organizationsService.deleteOrganization(
      id,
      this.extractActor(session),
    );
  }

  @Post('organizations/:id/invitations')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Undang anggota baru ke organisasi' })
  async inviteMember(
    @Param('id') id: string,
    @Body() body: InviteOrgMemberDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.organizationsService.inviteOrganizationMember(
      id,
      body,
      this.extractActor(session),
    );
  }

  @Delete('organizations/:id/invitations/:invitationId')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Batalkan undangan organisasi' })
  async cancelInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.organizationsService.cancelOrganizationInvitation(
      id,
      invitationId,
    );
  }

  @Patch('organizations/:id/members/:memberId')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Ubah role anggota organisasi' })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: UpdateOrgMemberRoleDto,
  ) {
    return this.organizationsService.updateOrganizationMemberRole(
      id,
      memberId,
      body,
    );
  }

  @Delete('organizations/:id/members/:memberId')
  @RequirePlatformPermission('organization:update')
  @ApiOperation({ summary: 'Hapus anggota organisasi' })
  async removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.organizationsService.removeOrganizationMember(id, memberId);
  }

  @Get('sessions')
  @RequirePlatformPermission('session:read')
  @ApiOperation({ summary: 'Daftar sesi aktif & kedaluwarsa' })
  async listSessions(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sinceDate') sinceDate?: string,
  ) {
    const paging = normalizePagination(Number(page), Number(pageSize));
    return this.sessionsService.listSessions({
      page: paging.page,
      pageSize: paging.pageSize,
      search,
      status,
      sinceDate,
    });
  }

  @Delete('sessions/:id')
  @RequirePlatformPermission('session:revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cabut satu sesi aktif' })
  async revokeSession(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.sessionsService.revokeSession(id, this.extractActor(session));
  }

  @Post('sessions/revoke-inactive')
  @RequirePlatformPermission('session:revoke')
  @ApiOperation({ summary: 'Hapus semua sesi yang sudah kedaluwarsa' })
  async revokeInactiveSessions() {
    const removed = await this.sessionsService.revokeInactiveSessions();
    return { removed };
  }

  @Get('api-keys')
  @RequirePlatformPermission('apiKey:read')
  @ApiOperation({ summary: 'Daftar API Key terdaftar' })
  async listApiKeys(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    const paging = normalizePagination(Number(page), Number(pageSize));
    return this.apiKeysService.listApiKeys({
      page: paging.page,
      pageSize: paging.pageSize,
      search,
    });
  }

  @Post('api-keys')
  @RequirePlatformPermission('apiKey:create')
  @ApiOperation({ summary: 'Terbitkan API Key baru' })
  async createApiKey(
    @Body() body: CreateApiKeyDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.apiKeysService.createApiKey(body, this.extractActor(session));
  }

  @Patch('api-keys/:id')
  @RequirePlatformPermission('apiKey:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Aktifkan/nonaktifkan API Key' })
  async toggleApiKey(
    @Param('id') id: string,
    @Body() body: ToggleApiKeyDto,
  ): Promise<void> {
    await this.apiKeysService.toggleApiKey(id, body.enabled);
  }

  @Delete('api-keys/:id')
  @RequirePlatformPermission('apiKey:revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cabut API Key permanen' })
  async deleteApiKey(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.apiKeysService.deleteApiKey(id, this.extractActor(session));
  }

  @Get('oauth-clients')
  @RequirePlatformPermission('oauthClient:read')
  @ApiOperation({ summary: 'Daftar OAuth 2.1 / OIDC / MCP Clients' })
  async listOAuthClients(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    const paging = normalizePagination(Number(page), Number(pageSize));
    return this.oauthSsoService.listOAuthClients({
      page: paging.page,
      pageSize: paging.pageSize,
      search,
    });
  }

  @Post('oauth-clients')
  @RequirePlatformPermission('oauthClient:create')
  @ApiOperation({ summary: 'Daftarkan OAuth / MCP client baru' })
  async createOAuthClient(
    @Body() body: CreateOAuthClientDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.oauthSsoService.createOAuthClient(
      body,
      this.extractActor(session),
    );
  }

  @Delete('oauth-clients/:id')
  @RequirePlatformPermission('oauthClient:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus OAuth client' })
  async deleteOAuthClient(@Param('id') id: string): Promise<void> {
    await this.oauthSsoService.deleteOAuthClient(id);
  }

  @Get('sso-providers')
  @RequirePlatformPermission('sso:read')
  @ApiOperation({ summary: 'Daftar Enterprise SSO Providers (SAML/OIDC)' })
  async listSsoProviders() {
    return this.oauthSsoService.listSsoProviders();
  }

  @Post('sso-providers')
  @RequirePlatformPermission('sso:configure')
  @ApiOperation({ summary: 'Registrasi provider Enterprise SSO baru' })
  async createSsoProvider(
    @Body() body: CreateSsoProviderDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.oauthSsoService.createSsoProvider(
      body,
      this.extractActor(session),
    );
  }

  @Delete('sso-providers/:id')
  @RequirePlatformPermission('sso:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus provider SSO' })
  async deleteSsoProvider(@Param('id') id: string): Promise<void> {
    await this.oauthSsoService.deleteSsoProvider(id);
  }

  @Get('audit-logs')
  @RequirePlatformPermission('auditLog:read')
  @ApiOperation({ summary: 'Stream audit logs dengan cursor pagination' })
  async listAuditLogs(
    @Query('cursor') cursor = '0',
    @Query('limit') limit = '25',
    @Query('search') search?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const paging = normalizeCursorPagination(Number(cursor), Number(limit));
    return this.auditService.fetchAuditLogsPage({
      cursor: paging.cursor,
      limit: paging.limit,
      search,
      severity,
      category,
      fromDate,
      toDate,
    });
  }
}
