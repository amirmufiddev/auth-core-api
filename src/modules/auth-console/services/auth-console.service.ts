import * as crypto from 'node:crypto';
import * as argon2 from 'argon2';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import { AuthFeatureConfigService } from '@/modules/auth';
import { EmailService } from '@/modules/email';
import { AppConfig } from '@/config';
import {
  BanConsoleUserDto,
  CreateApiKeyDto,
  CreateConsoleOrgDto,
  CreateConsoleRoleDto,
  CreateConsoleUserDto,
  CreateOAuthClientDto,
  CreateSsoProviderDto,
  InviteOrgMemberDto,
  UpdateConsoleOrgDto,
  UpdateConsoleRoleDto,
  UpdateConsoleUserDto,
  UpdateOrgMemberRoleDto,
} from '../dto/auth-console.dto';

export interface ConsoleActor {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthConsoleService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly featureConfigService: AuthFeatureConfigService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async getMe(userId: string) {
    const [found] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!found) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    const accounts = await this.db
      .select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.userId, userId));

    const passkeys = await this.db
      .select()
      .from(schema.passkey)
      .where(eq(schema.passkey.userId, userId));

    const memberships = await this.db
      .select({
        orgName: schema.organization.name,
      })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.member.organizationId, schema.organization.id),
      )
      .where(eq(schema.member.userId, userId))
      .limit(1);

    const linkedProviders = Array.from(
      new Set(
        accounts.map((a) =>
          a.providerId === 'credential' ? 'email' : a.providerId,
        ),
      ),
    );

    return {
      id: found.id,
      name: found.name,
      email: found.email,
      username: found.username ?? undefined,
      role: found.role ?? 'user',
      emailVerified: found.emailVerified,
      twoFactorEnabled: Boolean(found.twoFactorEnabled),
      organizationName: memberships[0]?.orgName ?? 'Auth Core HQ',
      avatarUrl: found.image ?? undefined,
      linkedProviders: linkedProviders.length > 0 ? linkedProviders : ['email'],
      passkeys: passkeys.map((pk) => ({
        id: pk.id,
        name: pk.name ?? 'WebAuthn Passkey',
        deviceType: pk.deviceType,
        createdAt: pk.createdAt
          ? pk.createdAt.toISOString()
          : new Date().toISOString(),
      })),
      backupCodes: [],
    };
  }

  async recordAudit(input: {
    event: string;
    category: string;
    severity: 'info' | 'warning' | 'critical';
    actor?: ConsoleActor;
    target: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.featureConfigService.isFeatureEnabled('auditLogs')) return;
    await this.db.insert(schema.auditTrailLogs).values({
      moduleKey: input.category,
      actorId: input.actor?.id ?? null,
      category: input.category,
      severity: input.severity,
      actorEmail: input.actor?.email ?? 'system@authcore.io',
      actorRole: input.actor?.role ?? 'system',
      target: input.target,
      ipAddress: '127.0.0.1',
      userAgent: 'AuthCoreAPI',
      action: input.event,
      entityType: input.category,
      entityId: input.target,
      metadata: input.metadata ?? {},
    });
  }

  async getDashboardMetrics() {
    const users = await this.db.select().from(schema.user);
    const sessions = await this.db.select().from(schema.session);
    const logs = await this.db
      .select()
      .from(schema.auditTrailLogs)
      .orderBy(desc(schema.auditTrailLogs.createdAt))
      .limit(100);

    const now = Date.now();
    const totalUsers = users.length;
    const bannedUsers = users.filter((u) => Boolean(u.banned)).length;
    const twoFactorUsers = users.filter((u) =>
      Boolean(u.twoFactorEnabled),
    ).length;
    const activeSessions = sessions.filter(
      (s) => s.expiresAt.getTime() > now,
    ).length;

    const since24h = now - 86400 * 1000;
    const authEvents24h = logs.filter(
      (l) => l.createdAt.getTime() >= since24h,
    ).length;

    const signInTrend = Array.from({ length: 14 }, (_, idx) => {
      const dayStart = new Date(now - (13 - idx) * 86400000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86400000;
      const dayEvents = logs.filter((l) => {
        const ts = l.createdAt.getTime();
        return ts >= dayStart.getTime() && ts < dayEnd;
      }).length;
      const daySessions = sessions.filter((s) => {
        const ts = s.createdAt.getTime();
        return ts >= dayStart.getTime() && ts < dayEnd;
      }).length;
      return {
        date: dayStart.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
        }),
        signIns: daySessions + dayEvents,
        tokensIssued: (daySessions + dayEvents) * 2,
      };
    });

    const methodMap: Record<string, number> = {};
    for (const u of users) {
      const key = (u.lastLoginMethod || 'email').toUpperCase();
      methodMap[key] = (methodMap[key] ?? 0) + 1;
    }

    const authMethodDistribution =
      Object.keys(methodMap).length > 0
        ? Object.entries(methodMap).map(([method, count]) => ({
            method,
            count,
          }))
        : [{ method: 'EMAIL', count: 0 }];

    return {
      totalUsers,
      activeSessions,
      bannedUsers,
      twoFactorAdoption: Math.round(
        (twoFactorUsers / Math.max(1, totalUsers)) * 100,
      ),
      authEvents24h,
      signInTrend,
      authMethodDistribution,
      recentEvents: logs.slice(0, 6).map((l) => this.mapAuditLog(l)),
    };
  }

  async listUsers(params: {
    page: number;
    pageSize: number;
    search?: string;
    role?: string;
    status?: string;
    sortBy?: string;
    sortDir?: string;
  }) {
    const allUsers = await this.db
      .select()
      .from(schema.user)
      .orderBy(desc(schema.user.createdAt));

    const passkeyCounts = new Map<string, number>();
    const allPasskeys = await this.db
      .select({ userId: schema.passkey.userId })
      .from(schema.passkey);
    for (const pk of allPasskeys) {
      passkeyCounts.set(pk.userId, (passkeyCounts.get(pk.userId) ?? 0) + 1);
    }

    const memberships = await this.db
      .select({
        userId: schema.member.userId,
        orgName: schema.organization.name,
      })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.member.organizationId, schema.organization.id),
      );
    const orgMap = new Map<string, string>();
    for (const m of memberships) {
      if (!orgMap.has(m.userId)) orgMap.set(m.userId, m.orgName);
    }

    let list = allUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username ?? undefined,
      phoneNumber: u.phoneNumber ?? undefined,
      role: u.role ?? 'user',
      emailVerified: u.emailVerified,
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
      passkeyCount: passkeyCounts.get(u.id) ?? 0,
      banned: Boolean(u.banned),
      banReason: u.banReason ?? undefined,
      banExpires: u.banExpires ? u.banExpires.toISOString() : undefined,
      image: u.image ?? undefined,
      organizationName: orgMap.get(u.id) ?? 'Auth Core HQ',
      lastLoginMethod: u.lastLoginMethod ?? 'email',
      lastActiveAt: u.updatedAt.toISOString(),
      createdAt: u.createdAt.toISOString(),
    }));

    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.username ?? '').toLowerCase().includes(q),
      );
    }

    if (params.role && params.role !== 'all') {
      list = list.filter((u) => u.role === params.role);
    }

    if (params.status && params.status !== 'all') {
      if (params.status === 'banned') list = list.filter((u) => u.banned);
      if (params.status === 'active') list = list.filter((u) => !u.banned);
      if (params.status === 'unverified')
        list = list.filter((u) => !u.emailVerified);
    }

    if (params.sortBy) {
      const dir = params.sortDir === 'desc' ? -1 : 1;
      const key = params.sortBy as keyof (typeof list)[number];
      list.sort(
        (a, b) =>
          String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * dir,
      );
    }

    const total = list.length;
    const start = params.page * params.pageSize;
    return {
      items: list.slice(start, start + params.pageSize),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async createUser(input: CreateConsoleUserDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [existing] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, input.email.toLowerCase()))
      .limit(1);
    if (existing) {
      throw new ConflictException('Email sudah terdaftar.');
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const accountId = `acc_${crypto.randomUUID()}`;
    const rawPassword = input.password || 'Admin12345!';
    const hashedPassword = await argon2.hash(rawPassword);
    const usernameValue = input.username || input.email.split('@')[0];

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.user).values({
        id: userId,
        name: input.name,
        email: input.email.toLowerCase(),
        emailVerified: input.emailVerified,
        role: input.role,
        username: usernameValue,
        displayUsername: usernameValue,
        twoFactorEnabled: input.twoFactorEnabled,
        lastLoginMethod: 'email',
      });

      await tx.insert(schema.account).values({
        id: accountId,
        accountId: userId,
        providerId: 'credential',
        userId,
        password: hashedPassword,
      });
    });

    await this.recordAudit({
      event: 'admin.user_created',
      category: 'admin',
      severity: 'info',
      actor,
      target: `user/${input.email}`,
      metadata: { role: input.role },
    });

    return {
      id: userId,
      name: input.name,
      email: input.email.toLowerCase(),
      username: usernameValue,
      role: input.role,
      emailVerified: input.emailVerified,
      twoFactorEnabled: input.twoFactorEnabled,
      passkeyCount: 0,
      banned: false,
      organizationName: input.organizationName || 'Auth Core HQ',
      lastLoginMethod: 'email',
      lastActiveAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  async updateUser(
    userId: string,
    patch: UpdateConsoleUserDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [existing] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    const [updated] = await this.db
      .update(schema.user)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.username !== undefined
          ? { username: patch.username, displayUsername: patch.username }
          : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.emailVerified !== undefined
          ? { emailVerified: patch.emailVerified }
          : {}),
        ...(patch.twoFactorEnabled !== undefined
          ? { twoFactorEnabled: patch.twoFactorEnabled }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId))
      .returning();

    await this.recordAudit({
      event: 'admin.user_updated',
      category: 'admin',
      severity: 'info',
      actor,
      target: `user/${updated.email}`,
      metadata: { role: updated.role ?? 'user' },
    });

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      username: updated.username ?? undefined,
      role: updated.role ?? 'user',
      emailVerified: updated.emailVerified,
      twoFactorEnabled: Boolean(updated.twoFactorEnabled),
      passkeyCount: 0,
      banned: Boolean(updated.banned),
      organizationName: patch.organizationName || 'Auth Core HQ',
      lastLoginMethod: updated.lastLoginMethod ?? 'email',
      lastActiveAt: updated.updatedAt.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async banOrUnbanUser(
    userId: string,
    input: BanConsoleUserDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [existing] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    const [updated] = await this.db
      .update(schema.user)
      .set({
        banned: input.banned,
        banReason: input.banned ? (input.banReason ?? null) : null,
        banExpires:
          input.banned && input.banExpires ? new Date(input.banExpires) : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId))
      .returning();

    if (input.banned) {
      await this.db
        .delete(schema.session)
        .where(eq(schema.session.userId, userId));
    }

    await this.recordAudit({
      event: input.banned ? 'admin.user_banned' : 'admin.user_unbanned',
      category: 'admin',
      severity: input.banned ? 'critical' : 'warning',
      actor,
      target: `user/${updated.email}`,
      metadata: { reason: input.banReason ?? 'none' },
    });

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      username: updated.username ?? undefined,
      role: updated.role ?? 'user',
      emailVerified: updated.emailVerified,
      twoFactorEnabled: Boolean(updated.twoFactorEnabled),
      passkeyCount: 0,
      banned: Boolean(updated.banned),
      banReason: updated.banReason ?? undefined,
      banExpires: updated.banExpires
        ? updated.banExpires.toISOString()
        : undefined,
      organizationName: 'Auth Core HQ',
      lastLoginMethod: updated.lastLoginMethod ?? 'email',
      lastActiveAt: updated.updatedAt.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async deleteUser(userId: string, actor: ConsoleActor): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [target] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!target) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    await this.db.delete(schema.user).where(eq(schema.user.id, userId));

    await this.recordAudit({
      event: 'admin.user_deleted',
      category: 'admin',
      severity: 'critical',
      actor,
      target: `user/${target.email}`,
      metadata: { userId },
    });
  }

  async listRoles() {
    const roles = await this.db
      .select()
      .from(schema.authCoreRole)
      .orderBy(schema.authCoreRole.createdAt);
    const users = await this.db
      .select({ role: schema.user.role })
      .from(schema.user);

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      isSystem: r.isSystem,
      userCount: users.filter((u) => (u.role ?? 'user') === r.slug).length,
      permissions: r.permissions ?? {},
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async createRole(input: CreateConsoleRoleDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [exists] = await this.db
      .select({ id: schema.authCoreRole.id })
      .from(schema.authCoreRole)
      .where(eq(schema.authCoreRole.slug, input.slug))
      .limit(1);
    if (exists) {
      throw new ConflictException('Slug role sudah digunakan.');
    }

    const [created] = await this.db
      .insert(schema.authCoreRole)
      .values({
        id: `role_${crypto.randomUUID()}`,
        name: input.name,
        slug: input.slug,
        description: input.description,
        isSystem: false,
        permissions: {},
      })
      .returning();

    await this.recordAudit({
      event: 'rbac.role_created',
      category: 'rbac',
      severity: 'info',
      actor,
      target: `role/${created.slug}`,
      metadata: { name: created.name },
    });

    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
      description: created.description,
      isSystem: created.isSystem,
      userCount: 0,
      permissions: created.permissions ?? {},
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async updateRole(
    roleId: string,
    input: UpdateConsoleRoleDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [existing] = await this.db
      .select()
      .from(schema.authCoreRole)
      .where(eq(schema.authCoreRole.id, roleId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Role tidak ditemukan.');
    }

    const [updated] = await this.db
      .update(schema.authCoreRole)
      .set({
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        updatedAt: new Date(),
      })
      .where(eq(schema.authCoreRole.id, roleId))
      .returning();

    await this.recordAudit({
      event: 'rbac.permissions_updated',
      category: 'rbac',
      severity: 'warning',
      actor,
      target: `role/${updated.slug}`,
      metadata: { roleId: updated.id },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      isSystem: updated.isSystem,
      userCount: 0,
      permissions: updated.permissions ?? {},
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteRole(roleId: string, actor: ConsoleActor): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('admin');

    const [target] = await this.db
      .select()
      .from(schema.authCoreRole)
      .where(eq(schema.authCoreRole.id, roleId))
      .limit(1);
    if (!target) {
      throw new NotFoundException('Role tidak ditemukan.');
    }
    if (target.isSystem) {
      throw new BadRequestException('Role sistem bawaan tidak dapat dihapus.');
    }

    await this.db
      .delete(schema.authCoreRole)
      .where(eq(schema.authCoreRole.id, roleId));

    await this.recordAudit({
      event: 'rbac.role_deleted',
      category: 'rbac',
      severity: 'critical',
      actor,
      target: `role/${target.slug}`,
      metadata: { roleId },
    });
  }

  private parseOrgMetadata(raw: string | null): {
    plan: 'Free' | 'Pro' | 'Enterprise';
    ssoEnabled: boolean;
  } {
    if (!raw) return { plan: 'Pro', ssoEnabled: false };
    try {
      const parsed = JSON.parse(raw) as {
        plan?: 'Free' | 'Pro' | 'Enterprise';
        ssoEnabled?: boolean;
      };
      return {
        plan: parsed.plan ?? 'Pro',
        ssoEnabled: Boolean(parsed.ssoEnabled),
      };
    } catch {
      return { plan: 'Pro', ssoEnabled: false };
    }
  }

  private async hydrateOrganization(org: schema.Organization) {
    const members = await this.db
      .select({
        id: schema.member.id,
        userId: schema.member.userId,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.organizationId, org.id));

    const teams = await this.db
      .select()
      .from(schema.team)
      .where(eq(schema.team.organizationId, org.id));

    const invitations = await this.db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.organizationId, org.id));

    const meta = this.parseOrgMetadata(org.metadata);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug ?? org.id,
      plan: meta.plan,
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

  async listOrganizations(params: {
    page: number;
    pageSize: number;
    search?: string;
  }) {
    this.featureConfigService.assertFeatureEnabled('organization');

    let orgs = await this.db
      .select()
      .from(schema.organization)
      .orderBy(desc(schema.organization.createdAt));

    if (params.search) {
      const q = params.search.toLowerCase();
      orgs = orgs.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          (o.slug ?? '').toLowerCase().includes(q),
      );
    }

    const total = orgs.length;
    const start = params.page * params.pageSize;
    const pageOrgs = orgs.slice(start, start + params.pageSize);
    const items = await Promise.all(
      pageOrgs.map((org) => this.hydrateOrganization(org)),
    );

    return {
      items,
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async createOrganization(input: CreateConsoleOrgDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const [exists] = await this.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, input.slug))
      .limit(1);
    if (exists) {
      throw new ConflictException('Slug organisasi sudah dipakai.');
    }

    const orgId = `org_${crypto.randomUUID()}`;
    const [created] = await this.db
      .insert(schema.organization)
      .values({
        id: orgId,
        // Temporary compile compatibility until Task 5 refactors auth-console to platform-console
        tenantId:
          (input as { tenantId?: string }).tenantId ?? 'ten_platform_default',
        name: input.name,
        slug: input.slug,
        metadata: JSON.stringify({
          plan: input.plan,
          ssoEnabled: input.ssoEnabled,
        }),
      })
      .returning();

    await this.db.insert(schema.member).values({
      id: `mem_${crypto.randomUUID()}`,
      organizationId: orgId,
      userId: actor.id,
      role: 'owner',
    });

    await this.db.insert(schema.team).values({
      id: `tm_${crypto.randomUUID()}`,
      name: 'General',
      memberCount: 1,
      organizationId: orgId,
    });

    await this.recordAudit({
      event: 'organization.created',
      category: 'organization',
      severity: 'info',
      actor,
      target: `org/${input.slug}`,
      metadata: { plan: input.plan },
    });

    return this.hydrateOrganization(created);
  }

  async updateOrganization(organizationId: string, patch: UpdateConsoleOrgDto) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const [existing] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }

    const meta = this.parseOrgMetadata(existing.metadata);
    const nextMeta = {
      plan: patch.plan ?? meta.plan,
      ssoEnabled:
        patch.ssoEnabled !== undefined ? patch.ssoEnabled : meta.ssoEnabled,
    };

    const [updated] = await this.db
      .update(schema.organization)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        metadata: JSON.stringify(nextMeta),
      })
      .where(eq(schema.organization.id, organizationId))
      .returning();

    return this.hydrateOrganization(updated);
  }

  async deleteOrganization(
    organizationId: string,
    actor: ConsoleActor,
  ): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('organization');

    const [existing] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }

    await this.db
      .delete(schema.organization)
      .where(eq(schema.organization.id, organizationId));

    await this.recordAudit({
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

    const [org] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }

    const invId = `inv_${crypto.randomUUID()}`;
    await this.db.insert(schema.invitation).values({
      id: invId,
      organizationId,
      email: input.email.toLowerCase(),
      role: input.role,
      status: 'pending',
      expiresAt: new Date(Date.now() + 2 * 86400000),
      inviterId: actor.id,
    });

    const { appName } = this.configService.get<AppConfig>('app', {
      infer: true,
    });
    const clientUrl = this.configService.get<string>('auth.clientUrl', {
      infer: true,
    });
    await this.emailService
      .send({
        to: input.email,
        subject: `[${appName}] Undangan Organisasi ${org.name}`,
        html: `<p>Anda diundang bergabung ke <strong>${org.name}</strong> sebagai <code>${input.role}</code>.</p><p>Buka <a href="${clientUrl}/auth/accept-invitation?id=${invId}">tautan ini</a> untuk menerima undangan.</p>`,
      })
      .catch(() => undefined);

    await this.recordAudit({
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

    const [org] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }

    await this.db
      .update(schema.member)
      .set({ role: input.role })
      .where(eq(schema.member.id, memberId));

    return this.hydrateOrganization(org);
  }

  async removeOrganizationMember(organizationId: string, memberId: string) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const [org] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }

    await this.db.delete(schema.member).where(eq(schema.member.id, memberId));

    return this.hydrateOrganization(org);
  }

  async cancelOrganizationInvitation(
    organizationId: string,
    invitationId: string,
  ) {
    this.featureConfigService.assertFeatureEnabled('organization');

    const [org] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }

    await this.db
      .delete(schema.invitation)
      .where(eq(schema.invitation.id, invitationId));

    return this.hydrateOrganization(org);
  }

  async listSessions(params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: string;
    sinceDate?: string;
  }) {
    const rows = await this.db
      .select({
        id: schema.session.id,
        userId: schema.session.userId,
        userName: schema.user.name,
        userEmail: schema.user.email,
        token: schema.session.token,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
        impersonatedBy: schema.session.impersonatedBy,
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
      })
      .from(schema.session)
      .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
      .orderBy(desc(schema.session.createdAt));

    const now = Date.now();
    let list = rows.map((r) => {
      const ua = r.userAgent ?? 'Unknown Client';
      const deviceType: 'Desktop' | 'Mobile' | 'CLI' | 'API' =
        /mobile|android|iphone/i.test(ua)
          ? 'Mobile'
          : /curl|cli|httpie/i.test(ua)
            ? 'CLI'
            : /node|fetch|axios/i.test(ua)
              ? 'API'
              : 'Desktop';

      return {
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        tokenPreview:
          r.token.length > 10
            ? `${r.token.slice(0, 6)}••••${r.token.slice(-4)}`
            : '••••',
        ipAddress: r.ipAddress ?? '127.0.0.1',
        userAgent: ua,
        deviceType,
        location: 'Local Network',
        impersonatedBy: r.impersonatedBy ?? undefined,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        active: r.expiresAt.getTime() > now,
      };
    });

    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (s) =>
          s.userName.toLowerCase().includes(q) ||
          s.userEmail.toLowerCase().includes(q) ||
          s.ipAddress.toLowerCase().includes(q) ||
          s.userAgent.toLowerCase().includes(q),
      );
    }

    if (params.status === 'active') list = list.filter((s) => s.active);
    if (params.status === 'expired') list = list.filter((s) => !s.active);

    if (params.sinceDate) {
      const minTs = new Date(params.sinceDate).getTime();
      if (!Number.isNaN(minTs)) {
        list = list.filter((s) => new Date(s.createdAt).getTime() >= minTs);
      }
    }

    const total = list.length;
    const start = params.page * params.pageSize;
    return {
      items: list.slice(start, start + params.pageSize),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async revokeSession(sessionId: string, actor: ConsoleActor): Promise<void> {
    const [target] = await this.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, sessionId))
      .limit(1);
    if (!target) {
      throw new NotFoundException('Sesi tidak ditemukan.');
    }

    await this.db
      .delete(schema.session)
      .where(eq(schema.session.id, sessionId));

    await this.recordAudit({
      event: 'session.revoked',
      category: 'auth',
      severity: 'warning',
      actor,
      target: `session/${sessionId}`,
      metadata: { userId: target.userId },
    });
  }

  async revokeInactiveSessions(): Promise<number> {
    const now = Date.now();
    const sessions = await this.db.select().from(schema.session);
    const expiredIds = sessions
      .filter((s) => s.expiresAt.getTime() <= now)
      .map((s) => s.id);
    if (expiredIds.length === 0) return 0;

    await this.db
      .delete(schema.session)
      .where(inArray(schema.session.id, expiredIds));
    return expiredIds.length;
  }

  async listApiKeys(params: {
    page: number;
    pageSize: number;
    search?: string;
  }) {
    this.featureConfigService.assertFeatureEnabled('apiKey');

    const keys = await this.db
      .select()
      .from(schema.apikey)
      .orderBy(desc(schema.apikey.createdAt));

    const users = await this.db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user);
    const emailMap = new Map(users.map((u) => [u.id, u.email]));

    let list = keys.map((k) => {
      let scopes: string[] = [];
      if (k.permissions) {
        try {
          const parsed = JSON.parse(k.permissions) as
            string[] | Record<string, string[]>;
          if (Array.isArray(parsed)) {
            scopes = parsed;
          } else {
            scopes = Object.entries(parsed).flatMap(([res, acts]) =>
              acts.map((a) => `${res}:${a}`),
            );
          }
        } catch {
          scopes = [];
        }
      }
      const prefix = k.prefix ?? 'ak_';
      return {
        id: k.id,
        name: k.name ?? 'API Key',
        prefix,
        keyPreview: `${k.start ?? prefix}••••••`,
        ownerEmail: emailMap.get(k.referenceId) ?? k.referenceId,
        scopes,
        rateLimitMax: k.rateLimitMax ?? 100,
        rateLimitWindow: Math.round((k.rateLimitTimeWindow ?? 60000) / 1000),
        enabled: Boolean(k.enabled),
        requestCount: k.requestCount ?? 0,
        lastUsedAt: k.lastRequest ? k.lastRequest.toISOString() : undefined,
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : undefined,
        createdAt: k.createdAt.toISOString(),
      };
    });

    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (k) =>
          k.name.toLowerCase().includes(q) ||
          k.ownerEmail.toLowerCase().includes(q) ||
          k.prefix.toLowerCase().includes(q),
      );
    }

    const total = list.length;
    const start = params.page * params.pageSize;
    return {
      items: list.slice(start, start + params.pageSize),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async createApiKey(input: CreateApiKeyDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('apiKey');

    const [owner] = await this.db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.email, input.ownerEmail.toLowerCase()))
      .limit(1);

    const referenceId = owner?.id ?? actor.id;
    const plainSecret = `${input.prefix}${crypto.randomBytes(24).toString('base64url')}`;
    const hashed = crypto
      .createHash('sha256')
      .update(plainSecret)
      .digest('base64url');
    const start = plainSecret.slice(0, input.prefix.length + 4);
    const id = `key_${crypto.randomUUID()}`;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const [created] = await this.db
      .insert(schema.apikey)
      .values({
        id,
        configId: 'default',
        name: input.name,
        start,
        referenceId,
        prefix: input.prefix,
        key: hashed,
        enabled: true,
        rateLimitEnabled: true,
        rateLimitMax: input.rateLimitMax,
        rateLimitTimeWindow: 60000,
        requestCount: 0,
        expiresAt,
        permissions: JSON.stringify(input.scopes),
      })
      .returning();

    await this.recordAudit({
      event: 'api_key.created',
      category: 'api-key',
      severity: 'info',
      actor,
      target: `key/${input.name}`,
      metadata: { scopes: input.scopes.join(',') },
    });

    return {
      record: {
        id: created.id,
        name: created.name ?? input.name,
        prefix: input.prefix,
        keyPreview: `${start}••••••${plainSecret.slice(-4)}`,
        ownerEmail: owner?.email ?? input.ownerEmail,
        scopes: input.scopes,
        rateLimitMax: input.rateLimitMax,
        rateLimitWindow: 60,
        enabled: true,
        requestCount: 0,
        expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
        createdAt: created.createdAt.toISOString(),
      },
      plainSecret,
    };
  }

  async toggleApiKey(keyId: string, enabled: boolean): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('apiKey');
    await this.db
      .update(schema.apikey)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(schema.apikey.id, keyId));
  }

  async deleteApiKey(keyId: string, actor: ConsoleActor): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('apiKey');
    const [target] = await this.db
      .select()
      .from(schema.apikey)
      .where(eq(schema.apikey.id, keyId))
      .limit(1);
    if (!target) {
      throw new NotFoundException('API Key tidak ditemukan.');
    }

    await this.db.delete(schema.apikey).where(eq(schema.apikey.id, keyId));

    await this.recordAudit({
      event: 'api_key.revoked',
      category: 'api-key',
      severity: 'warning',
      actor,
      target: `key/${target.name ?? keyId}`,
      metadata: { keyId },
    });
  }

  async listOAuthClients(params: {
    page: number;
    pageSize: number;
    search?: string;
  }) {
    this.featureConfigService.assertFeatureEnabled('oauthProvider');

    const rows = await this.db
      .select()
      .from(schema.oauthClient)
      .orderBy(desc(schema.oauthClient.createdAt));

    let list = rows.map((c) => {
      const meta = (c.metadata ?? {}) as {
        clientType?: 'oidc-confidential' | 'oidc-public' | 'mcp-client';
      };
      const type: 'oidc-confidential' | 'oidc-public' | 'mcp-client' =
        meta.clientType ??
        (c.tokenEndpointAuthMethod === 'none'
          ? 'oidc-public'
          : 'oidc-confidential');
      return {
        id: c.id,
        clientId: c.clientId,
        name: c.name ?? c.clientId,
        type,
        redirectUris: c.redirectUris ?? [],
        scopes: c.scopes ?? ['openid', 'profile', 'email'],
        pkceRequired: Boolean(c.requirePKCE ?? true),
        active: !Boolean(c.disabled),
        createdAt: (c.createdAt ?? new Date()).toISOString(),
      };
    });

    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.clientId.toLowerCase().includes(q),
      );
    }

    const total = list.length;
    const start = params.page * params.pageSize;
    return {
      items: list.slice(start, start + params.pageSize),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async createOAuthClient(input: CreateOAuthClientDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('oauthProvider');

    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const clientId = `${slug || 'client'}_${crypto.randomBytes(4).toString('hex')}`;
    const clientSecret =
      input.type === 'oidc-public'
        ? null
        : `ocs_${crypto.randomBytes(24).toString('hex')}`;

    const [created] = await this.db
      .insert(schema.oauthClient)
      .values({
        id: `oa_${crypto.randomUUID()}`,
        clientId,
        clientSecret,
        name: input.name,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        requirePKCE: input.pkceRequired,
        tokenEndpointAuthMethod:
          input.type === 'oidc-public' ? 'none' : 'client_secret_basic',
        applicationType: input.type === 'oidc-public' ? 'native' : 'web',
        disabled: false,
        userId: actor.id,
        metadata: { clientType: input.type },
      })
      .returning();

    return {
      id: created.id,
      clientId: created.clientId,
      name: created.name ?? input.name,
      type: input.type,
      redirectUris: created.redirectUris ?? [],
      scopes: created.scopes ?? input.scopes,
      pkceRequired: Boolean(created.requirePKCE),
      active: !Boolean(created.disabled),
      createdAt: (created.createdAt ?? new Date()).toISOString(),
    };
  }

  async deleteOAuthClient(id: string): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('oauthProvider');
    await this.db
      .delete(schema.oauthClient)
      .where(eq(schema.oauthClient.id, id));
  }

  async listSsoProviders() {
    this.featureConfigService.assertFeatureEnabled('sso');

    const rows = await this.db
      .select()
      .from(schema.ssoProvider)
      .orderBy(desc(schema.ssoProvider.createdAt));

    const orgs = await this.db
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization);
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));

    return rows.map((p) => {
      const protocol: 'saml2' | 'oidc' = p.samlConfig ? 'saml2' : 'oidc';
      let name = p.providerId;
      let scimEnabled = false;
      try {
        const raw = p.samlConfig || p.oidcConfig;
        if (raw) {
          const parsed = JSON.parse(raw) as {
            displayName?: string;
            scimEnabled?: boolean;
          };
          if (parsed.displayName) name = parsed.displayName;
          scimEnabled = Boolean(parsed.scimEnabled);
        }
      } catch {
        // ignore metadata parse failure
      }

      return {
        id: p.id,
        providerId: p.providerId,
        name,
        protocol,
        domain: p.domain,
        domainVerified: Boolean(p.domainVerified),
        organizationName:
          (p.organizationId ? orgMap.get(p.organizationId) : undefined) ??
          'Auth Core HQ',
        scimEnabled,
        scimGroupMappings: [
          { idpGroup: 'Administrators', appRole: 'org_manager' },
        ],
        createdAt: (p.createdAt ?? new Date()).toISOString(),
      };
    });
  }

  async createSsoProvider(input: CreateSsoProviderDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('sso');

    const providerId = `${input.protocol}-${input.domain.replace(/\./g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
    const configPayload = JSON.stringify({
      displayName: input.name,
      scimEnabled: input.scimEnabled,
    });

    const [created] = await this.db
      .insert(schema.ssoProvider)
      .values({
        id: `sso_${crypto.randomUUID()}`,
        providerId,
        issuer: `https://${input.domain}`,
        domain: input.domain,
        domainVerified: false,
        userId: actor.id,
        samlConfig: input.protocol === 'saml2' ? configPayload : null,
        oidcConfig: input.protocol === 'oidc' ? configPayload : null,
      })
      .returning();

    return {
      id: created.id,
      providerId: created.providerId,
      name: input.name,
      protocol: input.protocol,
      domain: created.domain,
      domainVerified: Boolean(created.domainVerified),
      organizationName: input.organizationName,
      scimEnabled: input.scimEnabled,
      scimGroupMappings: [
        { idpGroup: 'Administrators', appRole: 'org_manager' },
      ],
      createdAt: (created.createdAt ?? new Date()).toISOString(),
    };
  }

  async deleteSsoProvider(id: string): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('sso');
    await this.db
      .delete(schema.ssoProvider)
      .where(eq(schema.ssoProvider.id, id));
  }

  private mapAuditLog(row: schema.AuditTrailLog) {
    return {
      id: row.id,
      event: row.action,
      category: (row.category || row.moduleKey || 'auth') as
        'auth' | 'admin' | 'rbac' | 'organization' | 'api-key' | 'config',
      severity: (row.severity || 'info') as 'info' | 'warning' | 'critical',
      actorEmail: row.actorEmail ?? 'system@authcore.io',
      actorRole: row.actorRole ?? 'system',
      target: row.target ?? `${row.entityType}/${row.entityId}`,
      ipAddress: row.ipAddress ?? '127.0.0.1',
      userAgent: row.userAgent ?? 'AuthCoreAPI',
      createdAt: row.createdAt.toISOString(),
      metadata: (row.metadata ?? {}) as Record<
        string,
        string | number | boolean
      >,
    };
  }

  async fetchAuditLogsPage(params: {
    cursor: number;
    limit: number;
    search?: string;
    severity?: string;
    category?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    this.featureConfigService.assertFeatureEnabled('auditLogs');

    const rows = await this.db
      .select()
      .from(schema.auditTrailLogs)
      .orderBy(desc(schema.auditTrailLogs.createdAt));

    let list = rows.map((r) => this.mapAuditLog(r));

    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (item) =>
          item.event.toLowerCase().includes(q) ||
          item.actorEmail.toLowerCase().includes(q) ||
          item.target.toLowerCase().includes(q) ||
          item.ipAddress.toLowerCase().includes(q),
      );
    }

    if (params.severity && params.severity !== 'all') {
      list = list.filter((item) => item.severity === params.severity);
    }

    if (params.category && params.category !== 'all') {
      list = list.filter((item) => item.category === params.category);
    }

    if (params.fromDate) {
      const minTime = new Date(params.fromDate).getTime();
      if (!Number.isNaN(minTime)) {
        list = list.filter(
          (item) => new Date(item.createdAt).getTime() >= minTime,
        );
      }
    }

    if (params.toDate) {
      const maxTime = new Date(`${params.toDate}T23:59:59.999`).getTime();
      if (!Number.isNaN(maxTime)) {
        list = list.filter(
          (item) => new Date(item.createdAt).getTime() <= maxTime,
        );
      }
    }

    const totalCount = list.length;
    const start = params.cursor;
    const end = start + params.limit;
    const items = list.slice(start, end);
    const nextCursor = end < totalCount ? end : null;

    return {
      items,
      nextCursor,
      totalCount,
    };
  }
}
