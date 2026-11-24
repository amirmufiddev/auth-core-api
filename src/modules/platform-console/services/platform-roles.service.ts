import * as crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthCoreRoleRow } from '@/database/schema';
import { AuthFeatureConfigService } from '@/modules/auth';
import type {
  CreateConsoleRoleDto,
  UpdateConsoleRoleDto,
} from '../dto/platform-console.dto';
import {
  type ConsoleActor,
  type IPlatformRoleRepository,
  type IPlatformUserRepository,
  PLATFORM_ROLE_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from '../interfaces';
import { PlatformAuditService } from './platform-audit.service';
import { assertPlatformPermissionMatrix } from '../constants/platform-permissions.catalog';

@Injectable()
export class PlatformRolesService {
  constructor(
    @Inject(PLATFORM_ROLE_REPOSITORY_TOKEN)
    private readonly roleRepo: IPlatformRoleRepository,
    @Inject(PLATFORM_USER_REPOSITORY_TOKEN)
    private readonly userRepo: IPlatformUserRepository,
    private readonly featureConfigService: AuthFeatureConfigService,
    private readonly auditService: PlatformAuditService,
  ) {}

  private mapRole(role: AuthCoreRoleRow, userCount: number) {
    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      userCount,
      permissions: role.permissions ?? {},
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  async listRoles() {
    const [roles, roleCounts] = await Promise.all([
      this.roleRepo.listAll(),
      this.userRepo.getUserCountsByRole(),
    ]);

    return roles.map((r) => this.mapRole(r, roleCounts.get(r.slug) ?? 0));
  }

  async createRole(input: CreateConsoleRoleDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const exists = await this.roleRepo.findBySlug(input.slug);
    if (exists) {
      throw new ConflictException('Slug role sudah digunakan.');
    }

    const created = await this.roleRepo.create({
      id: `role_${crypto.randomUUID()}`,
      name: input.name,
      slug: input.slug,
      description: input.description,
    });

    await this.auditService.recordAudit({
      event: 'rbac.role_created',
      category: 'rbac',
      severity: 'info',
      actor,
      target: `role/${created.slug}`,
      metadata: { name: created.name },
    });

    return this.mapRole(created, 0);
  }

  async updateRole(
    roleId: string,
    input: UpdateConsoleRoleDto,
    actor: ConsoleActor,
  ) {
    this.featureConfigService.assertFeatureEnabled('admin');

    const existing = await this.roleRepo.findById(roleId);
    if (!existing) {
      throw new NotFoundException('Role tidak ditemukan.');
    }

    assertPlatformPermissionMatrix(input.permissions);

    const updated = await this.roleRepo.update(roleId, {
      name: input.name,
      description: input.description,
      permissions: input.permissions,
    });

    await this.auditService.recordAudit({
      event: 'rbac.permissions_updated',
      category: 'rbac',
      severity: 'warning',
      actor,
      target: `role/${updated.slug}`,
      metadata: { roleId: updated.id },
    });

    return this.mapRole(updated, 0);
  }

  async deleteRole(roleId: string, actor: ConsoleActor): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('admin');

    const target = await this.roleRepo.findById(roleId);
    if (!target) {
      throw new NotFoundException('Role tidak ditemukan.');
    }
    if (target.isSystem) {
      throw new BadRequestException('Role sistem bawaan tidak dapat dihapus.');
    }

    await this.roleRepo.deleteById(roleId);

    await this.auditService.recordAudit({
      event: 'rbac.role_deleted',
      category: 'rbac',
      severity: 'critical',
      actor,
      target: `role/${target.slug}`,
      metadata: { roleId },
    });
  }
}
