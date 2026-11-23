import * as crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@/config';
import type { Organization } from '@/database/schema';
import { AuthFeatureConfigService } from '@/modules/auth';
import { EmailService } from '@/modules/email';
import type {
  CreateConsoleOrgDto,
  InviteOrgMemberDto,
  UpdateConsoleOrgDto,
  UpdateOrgMemberRoleDto,
} from '../dto/platform-console.dto';
import {
  type ConsoleActor,
  type IPlatformOrganizationRepository,
  type ListOrganizationsQuery,
  PLATFORM_ORGANIZATION_REPOSITORY_TOKEN,
} from '../interfaces';
import { PlatformAuditService } from './platform-audit.service';

@Injectable()
export class PlatformOrganizationsService {
  constructor(
    @Inject(PLATFORM_ORGANIZATION_REPOSITORY_TOKEN)
    private readonly orgRepo: IPlatformOrganizationRepository,
    private readonly featureConfigService: AuthFeatureConfigService,
    private readonly auditService: PlatformAuditService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  private parseOrgMetadata(raw: string | null): { ssoEnabled: boolean } {
    if (!raw) return { ssoEnabled: false };
    try {
      const parsed = JSON.parse(raw) as { ssoEnabled?: boolean };
      return { ssoEnabled: Boolean(parsed.ssoEnabled) };
    } catch {
      return { ssoEnabled: false };
    }
  }

  private async hydrateOrganization(org: Organization) {
    const { members, teams, invitations } =
      await this.orgRepo.getHydrationRelations(org.id);
    const meta = this.parseOrgMetadata(org.metadata);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug ?? org.id,
      ssoEnabled: meta.ssoEnabled,
      memberCount: members.length,
      teamCount: teams.length,
      createdAt: org.createdAt.toISOString(),
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: (m.role as 'owner' | 'admin' | 'member') || 'member',
        teamName: teams[0]?.name ?? 'General',
        joinedAt: m.createdAt.toISOString(),
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        memberCount: t.memberCount,
        createdAt: t.createdAt.toISOString(),
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: (i.role as 'admin' | 'member') || 'member',
        status: (i.status as 'pending' | 'accepted' | 'expired') || 'pending',
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  private async requireOrganization(organizationId: string) {
    const org = await this.orgRepo.findById(organizationId);
    if (!org) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }
    return org;
  }

  async listOrganizations(query: ListOrganizationsQuery) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const { items: pageOrgs, total } = await this.orgRepo.listPaginated(query);
    const items = await Promise.all(
      pageOrgs.map((org) => this.hydrateOrganization(org)),
    );

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createOrganization(input: CreateConsoleOrgDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const tenantId = input.tenantId?.trim();
    if (!tenantId) {
      throw new BadRequestException(
        'tenantId diperlukan untuk membuat organisasi',
      );
    }

    const tenantValid = await this.orgRepo.tenantExists(tenantId);
    if (!tenantValid) {
      throw new BadRequestException('Tenant tidak ditemukan.');
    }

    const exists = await this.orgRepo.findByTenantAndSlug(tenantId, input.slug);
    if (exists) {
      throw new ConflictException('Slug organisasi sudah dipakai.');
    }

    const created = await this.orgRepo.createWithOwner({
      id: `org_${crypto.randomUUID()}`,
      tenantId,
      name: input.name,
      slug: input.slug,
      metadata: JSON.stringify({ ssoEnabled: input.ssoEnabled }),
      ownerMemberId: `mem_${crypto.randomUUID()}`,
      ownerUserId: actor.id,
      defaultTeamId: `tm_${crypto.randomUUID()}`,
    });

    await this.auditService.recordAudit({
      event: 'organization.created',
      category: 'organization',
      severity: 'info',
      actor,
      target: `org/${input.slug}`,
      metadata: { tenantId, ssoEnabled: input.ssoEnabled },
    });

    return this.hydrateOrganization(created);
  }

  async updateOrganization(organizationId: string, patch: UpdateConsoleOrgDto) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const existing = await this.requireOrganization(organizationId);
    const meta = this.parseOrgMetadata(existing.metadata);
    const nextMeta = {
      ssoEnabled:
        patch.ssoEnabled !== undefined ? patch.ssoEnabled : meta.ssoEnabled,
    };

    const updated = await this.orgRepo.update(organizationId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      metadata: JSON.stringify(nextMeta),
    });

    return this.hydrateOrganization(updated);
  }

  async deleteOrganization(
    organizationId: string,
    actor: ConsoleActor,
  ): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('organization');

    const existing = await this.requireOrganization(organizationId);
    await this.orgRepo.deleteById(organizationId);

    await this.auditService.recordAudit({
      event: 'organization.deleted',
      category: 'organization',
      severity: 'critical',
      actor,
      target: `org/${existing.slug ?? existing.id}`,
      metadata: { organizationId },
    });
  }

  async inviteOrganizationMember(
    organizationId: string,
    input: InviteOrgMemberDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const org = await this.requireOrganization(organizationId);
    const invId = `inv_${crypto.randomUUID()}`;

    await this.orgRepo.createInvitation({
      id: invId,
      tenantId: org.tenantId,
      organizationId,
      email: input.email.toLowerCase(),
      role: input.role,
      expiresAt: new Date(Date.now() + 2 * 86400000),
      inviterId: actor.id,
    });

    const appName =
      this.configService.get<AppConfig>('app', { infer: true })?.appName ??
      'Auth Core';
    const clientUrl =
      this.configService.get<string>('auth.clientUrl', { infer: true }) ??
      'http://localhost:2000';

    await this.emailService
      .send({
        to: input.email,
        subject: `[${appName}] Undangan Organisasi ${org.name}`,
        html: `<p>Anda diundang bergabung ke <strong>${org.name}</strong> sebagai <code>${input.role}</code>.</p><p>Buka <a href="${clientUrl}/auth/accept-invitation?id=${invId}">tautan ini</a> untuk menerima undangan.</p>`,
      })
      .catch(() => undefined);

    await this.auditService.recordAudit({
      event: 'organization.member_invited',
      category: 'organization',
      severity: 'info',
      actor,
      target: `org/${org.slug ?? org.id}`,
      metadata: { invitee: input.email, role: input.role },
    });

    return this.hydrateOrganization(org);
  }

  async updateOrganizationMemberRole(
    organizationId: string,
    memberId: string,
    input: UpdateOrgMemberRoleDto,
  ) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const org = await this.requireOrganization(organizationId);
    const updated = await this.orgRepo.updateMemberRole(
      organizationId,
      memberId,
      input.role,
    );
    if (!updated) {
      throw new NotFoundException('Anggota organisasi tidak ditemukan.');
    }

    return this.hydrateOrganization(org);
  }

  async removeOrganizationMember(organizationId: string, memberId: string) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const org = await this.requireOrganization(organizationId);
    const deleted = await this.orgRepo.removeMember(organizationId, memberId);
    if (!deleted) {
      throw new NotFoundException('Anggota organisasi tidak ditemukan.');
    }

    return this.hydrateOrganization(org);
  }

  async cancelOrganizationInvitation(
    organizationId: string,
    invitationId: string,
  ) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const org = await this.requireOrganization(organizationId);
    const deleted = await this.orgRepo.cancelInvitation(
      organizationId,
      invitationId,
    );
    if (!deleted) {
      throw new NotFoundException('Undangan organisasi tidak ditemukan.');
    }

    return this.hydrateOrganization(org);
  }
}
