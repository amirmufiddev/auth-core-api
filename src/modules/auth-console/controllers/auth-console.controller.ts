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
import { Roles, Session } from '@thallesp/nestjs-better-auth';
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
} from '../dto/auth-console.dto';
import {
  AuthConsoleService,
  type ConsoleActor,
} from '../services/auth-console.service';

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
export class AuthConsoleController {
  constructor(private readonly consoleService: AuthConsoleService) {}

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
    const actor = this.extractActor(session);
    return this.consoleService.getMe(actor.id);
  }

  @Get('metrics')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'KPI & metrik ringkas Auth Core' })
  async getMetrics() {
    return this.consoleService.getDashboardMetrics();
  }

  @Get('users')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar user terpaginasi' })
  async listUsers(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.consoleService.listUsers({
      page: Number(page) || 0,
      pageSize: Math.min(100, Number(pageSize) || 10),
      search,
      role,
      status,
      sortBy,
      sortDir,
    });
  }

  @Post('users')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Buat user baru dari konsol admin' })
  async createUser(
    @Body() body: CreateConsoleUserDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.createUser(body, this.extractActor(session));
  }

  @Patch('users/:id')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Perbarui data user' })
  async updateUser(
    @Param('id') id: string,
    @Body() body: UpdateConsoleUserDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.updateUser(id, body, this.extractActor(session));
  }

  @Post('users/:id/ban')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Ban atau unban user' })
  async banUser(
    @Param('id') id: string,
    @Body() body: BanConsoleUserDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.banOrUnbanUser(
      id,
      body,
      this.extractActor(session),
    );
  }

  @Delete('users/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus user permanen' })
  async deleteUser(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.consoleService.deleteUser(id, this.extractActor(session));
  }

  @Get('roles')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar role RBAC Auth Core' })
  async listRoles() {
    return this.consoleService.listRoles();
  }

  @Post('roles')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Buat role RBAC baru' })
  async createRole(
    @Body() body: CreateConsoleRoleDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.createRole(body, this.extractActor(session));
  }

  @Patch('roles/:id')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Perbarui matriks permission role' })
  async updateRole(
    @Param('id') id: string,
    @Body() body: UpdateConsoleRoleDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.updateRole(id, body, this.extractActor(session));
  }

  @Delete('roles/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus role kustom' })
  async deleteRole(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.consoleService.deleteRole(id, this.extractActor(session));
  }

  @Get('organizations')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar organisasi multi-tenant' })
  async listOrganizations(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    return this.consoleService.listOrganizations({
      page: Number(page) || 0,
      pageSize: Math.min(100, Number(pageSize) || 10),
      search,
    });
  }

  @Post('organizations')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Buat organisasi baru' })
  async createOrganization(
    @Body() body: CreateConsoleOrgDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.createOrganization(
      body,
      this.extractActor(session),
    );
  }

  @Patch('organizations/:id')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Perbarui organisasi' })
  async updateOrganization(
    @Param('id') id: string,
    @Body() body: UpdateConsoleOrgDto,
  ) {
    return this.consoleService.updateOrganization(id, body);
  }

  @Delete('organizations/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus organisasi' })
  async deleteOrganization(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.consoleService.deleteOrganization(
      id,
      this.extractActor(session),
    );
  }

  @Post('organizations/:id/invitations')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Undang anggota baru ke organisasi' })
  async inviteMember(
    @Param('id') id: string,
    @Body() body: InviteOrgMemberDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.inviteOrganizationMember(
      id,
      body,
      this.extractActor(session),
    );
  }

  @Delete('organizations/:id/invitations/:invitationId')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Batalkan undangan organisasi' })
  async cancelInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.consoleService.cancelOrganizationInvitation(id, invitationId);
  }

  @Patch('organizations/:id/members/:memberId')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Ubah role anggota organisasi' })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: UpdateOrgMemberRoleDto,
  ) {
    return this.consoleService.updateOrganizationMemberRole(id, memberId, body);
  }

  @Delete('organizations/:id/members/:memberId')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Hapus anggota organisasi' })
  async removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.consoleService.removeOrganizationMember(id, memberId);
  }

  @Get('sessions')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar sesi aktif & kedaluwarsa' })
  async listSessions(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sinceDate') sinceDate?: string,
  ) {
    return this.consoleService.listSessions({
      page: Number(page) || 0,
      pageSize: Math.min(100, Number(pageSize) || 10),
      search,
      status,
      sinceDate,
    });
  }

  @Delete('sessions/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cabut satu sesi aktif' })
  async revokeSession(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.consoleService.revokeSession(id, this.extractActor(session));
  }

  @Post('sessions/revoke-inactive')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Hapus semua sesi yang sudah kedaluwarsa' })
  async revokeInactiveSessions() {
    const removed = await this.consoleService.revokeInactiveSessions();
    return { removed };
  }

  @Get('api-keys')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar API Key terdaftar' })
  async listApiKeys(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    return this.consoleService.listApiKeys({
      page: Number(page) || 0,
      pageSize: Math.min(100, Number(pageSize) || 10),
      search,
    });
  }

  @Post('api-keys')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Terbitkan API Key baru' })
  async createApiKey(
    @Body() body: CreateApiKeyDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.createApiKey(body, this.extractActor(session));
  }

  @Patch('api-keys/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Aktifkan/nonaktifkan API Key' })
  async toggleApiKey(
    @Param('id') id: string,
    @Body() body: ToggleApiKeyDto,
  ): Promise<void> {
    await this.consoleService.toggleApiKey(id, body.enabled);
  }

  @Delete('api-keys/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cabut API Key permanen' })
  async deleteApiKey(
    @Param('id') id: string,
    @Session() session: AuthSessionContext | null,
  ): Promise<void> {
    await this.consoleService.deleteApiKey(id, this.extractActor(session));
  }

  @Get('oauth-clients')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar OAuth 2.1 / OIDC / MCP Clients' })
  async listOAuthClients(
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    return this.consoleService.listOAuthClients({
      page: Number(page) || 0,
      pageSize: Math.min(100, Number(pageSize) || 10),
      search,
    });
  }

  @Post('oauth-clients')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftarkan OAuth / MCP client baru' })
  async createOAuthClient(
    @Body() body: CreateOAuthClientDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.createOAuthClient(
      body,
      this.extractActor(session),
    );
  }

  @Delete('oauth-clients/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus OAuth client' })
  async deleteOAuthClient(@Param('id') id: string): Promise<void> {
    await this.consoleService.deleteOAuthClient(id);
  }

  @Get('sso-providers')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Daftar Enterprise SSO Providers (SAML/OIDC)' })
  async listSsoProviders() {
    return this.consoleService.listSsoProviders();
  }

  @Post('sso-providers')
  @Roles(['super_admin', 'admin'])
  @ApiOperation({ summary: 'Registrasi provider Enterprise SSO baru' })
  async createSsoProvider(
    @Body() body: CreateSsoProviderDto,
    @Session() session: AuthSessionContext | null,
  ) {
    return this.consoleService.createSsoProvider(
      body,
      this.extractActor(session),
    );
  }

  @Delete('sso-providers/:id')
  @Roles(['super_admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hapus provider SSO' })
  async deleteSsoProvider(@Param('id') id: string): Promise<void> {
    await this.consoleService.deleteSsoProvider(id);
  }

  @Get('audit-logs')
  @Roles(['super_admin', 'admin'])
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
    return this.consoleService.fetchAuditLogsPage({
      cursor: Number(cursor) || 0,
      limit: Math.min(100, Number(limit) || 25),
      search,
      severity,
      category,
      fromDate,
      toDate,
    });
  }
}
