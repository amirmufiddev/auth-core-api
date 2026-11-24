import * as crypto from 'node:crypto';
import * as argon2 from 'argon2';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@/config';
import { AuthFeatureConfigService } from '@/modules/auth';
import { EmailService } from '@/modules/email';
import { mapPlatformUserRecord } from '../dto/platform-user.mapper';
import type {
  BanConsoleUserDto,
  CreateConsoleUserDto,
  UpdateConsoleUserDto,
} from '../dto/platform-console.dto';
import {
  type ConsoleActor,
  type IPlatformAuditRepository,
  type IPlatformSessionRepository,
  type IPlatformUserRepository,
  type ListUsersQuery,
  PLATFORM_AUDIT_REPOSITORY_TOKEN,
  PLATFORM_SESSION_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from '../interfaces';

@Injectable()
export class PlatformUsersService {
  constructor(
    @Inject(PLATFORM_USER_REPOSITORY_TOKEN)
    private readonly userRepo: IPlatformUserRepository,
    @Inject(PLATFORM_SESSION_REPOSITORY_TOKEN)
    private readonly sessionRepo: IPlatformSessionRepository,
    @Inject(PLATFORM_AUDIT_REPOSITORY_TOKEN)
    private readonly auditRepo: IPlatformAuditRepository,
    private readonly featureConfigService: AuthFeatureConfigService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  private async logAudit(input: {
    event: string;
    severity: 'info' | 'warning' | 'critical';
    actor: ConsoleActor;
    target: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.featureConfigService.isFeatureEnabled('auditLogs')) return;

    await this.auditRepo.create({
      moduleKey: 'admin',
      actorId: input.actor.id,
      category: 'admin',
      severity: input.severity,
      actorEmail: input.actor.email,
      actorRole: input.actor.role,
      target: input.target,
      ipAddress: '127.0.0.1',
      userAgent: 'AuthCoreAPI',
      action: input.event,
      entityType: 'admin',
      entityId: input.target,
      metadata: input.metadata ?? {},
    });
  }

  async getMe(userId: string) {
    const found = await this.userRepo.findPlatformById(userId);
    if (!found) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    const relations = await this.userRepo.getProfileRelations(userId);
    const linkedProviders = Array.from(
      new Set(
        relations.accounts.map((a) =>
          a.providerId === 'credential' ? 'email' : a.providerId,
        ),
      ),
    );

    return {
      id: found.id,
      tenantId: null,
      name: found.name,
      email: found.email,
      username: found.username ?? undefined,
      role: found.role ?? 'user',
      emailVerified: found.emailVerified,
      twoFactorEnabled: Boolean(found.twoFactorEnabled),
      organizationName: relations.organizationName ?? 'Auth Core HQ',
      avatarUrl: found.image ?? undefined,
      linkedProviders: linkedProviders.length > 0 ? linkedProviders : ['email'],
      passkeys: relations.passkeys.map((pk) => ({
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

  async listUsers(query: ListUsersQuery) {
    const { items, total } = await this.userRepo.listPaginated(query);
    const userIds = items.map((u) => u.id);

    const [passkeyCounts, orgNames] = await Promise.all([
      this.userRepo.getPasskeyCounts(userIds),
      this.userRepo.getPrimaryOrgNames(userIds),
    ]);

    return {
      items: items.map((u) =>
        mapPlatformUserRecord(
          u,
          passkeyCounts.get(u.id) ?? 0,
          orgNames.get(u.id) ?? 'Auth Core HQ',
        ),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createUser(input: CreateConsoleUserDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const normalizedEmail = input.email.toLowerCase();
    const existing = await this.userRepo.findPlatformByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException('Email sudah terdaftar.');
    }

    const hasExplicitPassword =
      typeof input.password === 'string' && input.password.length > 0;
    const rawPassword = hasExplicitPassword
      ? input.password!
      : crypto.randomBytes(24).toString('base64url');
    const passwordHash = await argon2.hash(rawPassword);
    const usernameValue = input.username || normalizedEmail.split('@')[0];

    const created = await this.userRepo.createPlatformUser({
      id: `usr_${crypto.randomUUID()}`,
      accountId: `acc_${crypto.randomUUID()}`,
      name: input.name,
      email: normalizedEmail,
      username: usernameValue,
      role: input.role,
      emailVerified: input.emailVerified,
      twoFactorEnabled: input.twoFactorEnabled,
      passwordHash,
    });

    if (!hasExplicitPassword) {
      const appName =
        this.configService.get<AppConfig>('app', { infer: true })?.appName ??
        'Auth Core';
      const clientUrl =
        this.configService.get<string>('auth.clientUrl', { infer: true }) ??
        'http://localhost:2000';
      await this.emailService
        .send({
          to: normalizedEmail,
          subject: `[${appName}] Akun Anda Telah Dibuat`,
          html: `<p>Akun Anda telah dibuat oleh administrator. Silakan atur kata sandi Anda melalui <a href="${clientUrl}/forgot-password">halaman reset kata sandi</a>.</p>`,
        })
        .catch(() => undefined);
    }

    await this.logAudit({
      event: 'admin.user_created',
      severity: 'info',
      actor,
      target: `user/${normalizedEmail}`,
      metadata: { role: input.role },
    });

    return mapPlatformUserRecord(
      created,
      0,
      input.organizationName || 'Auth Core HQ',
    );
  }

  async updateUser(
    userId: string,
    patch: UpdateConsoleUserDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const existing = await this.userRepo.findPlatformById(userId);
    if (!existing) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    const updated = await this.userRepo.updatePlatformUser(userId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined
        ? { email: patch.email.toLowerCase() }
        : {}),
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
    });

    await this.logAudit({
      event: 'admin.user_updated',
      severity: 'info',
      actor,
      target: `user/${updated.email}`,
      metadata: { role: updated.role ?? 'user' },
    });

    return mapPlatformUserRecord(
      updated,
      0,
      patch.organizationName || 'Auth Core HQ',
    );
  }

  async banOrUnbanUser(
    userId: string,
    input: BanConsoleUserDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const existing = await this.userRepo.findPlatformById(userId);
    if (!existing) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    const updated = await this.userRepo.updatePlatformUser(userId, {
      banned: input.banned,
      banReason: input.banned ? (input.banReason ?? null) : null,
      banExpires:
        input.banned && input.banExpires ? new Date(input.banExpires) : null,
    });

    if (input.banned) {
      await this.sessionRepo.deleteByUserId(userId);
    }

    await this.logAudit({
      event: input.banned ? 'admin.user_banned' : 'admin.user_unbanned',
      severity: input.banned ? 'critical' : 'warning',
      actor,
      target: `user/${updated.email}`,
      metadata: { reason: input.banReason ?? 'none' },
    });

    return mapPlatformUserRecord(updated);
  }

  async deleteUser(userId: string, actor: ConsoleActor): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('admin');

    const target = await this.userRepo.findPlatformById(userId);
    if (!target) {
      throw new NotFoundException('User tidak ditemukan.');
    }

    await this.userRepo.deletePlatformUser(userId);

    await this.logAudit({
      event: 'admin.user_deleted',
      severity: 'critical',
      actor,
      target: `user/${target.email}`,
      metadata: { userId },
    });
  }
}
