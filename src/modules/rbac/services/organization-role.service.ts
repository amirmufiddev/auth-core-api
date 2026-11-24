import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { BusinessError } from '@/common/errors/business-error';
import { OrganizationRole } from '@/database/schema';
import { TenantContextStorage } from '@/modules/tenant/context/tenant-context.storage';
import {
  ORGANIZATION_ROLE_REPOSITORY_TOKEN,
  type IOrganizationRoleRepository,
} from '../interfaces/organization-role-repository.interface';
import type { UpsertOrganizationRoleDto } from '../dto/organization-role.dto';
import { RbacPermissionService } from './rbac-permission.service';

const RESERVED_OWNER = 'owner';

type BetterAuthOrganizationRole = {
  id: string;
  role: string;
  organizationId: string;
  permission: Record<string, string[]>;
  permissionScopes?: Record<string, string>;
};

@Injectable()
export class OrganizationRoleService {
  constructor(
    @Inject(ORGANIZATION_ROLE_REPOSITORY_TOKEN)
    private readonly roleRepo: IOrganizationRoleRepository,
    private readonly authService: AuthService,
    private readonly eventEmitter: EventEmitter2,
    private readonly permissionService: RbacPermissionService,
  ) {}

  async list(organizationId: string): Promise<OrganizationRole[]> {
    await this.assertOrganizationTenantScope(organizationId);
    return this.roleRepo.findByOrganization(organizationId);
  }

  async getById(
    organizationId: string,
    roleId: string,
  ): Promise<OrganizationRole> {
    await this.assertOrganizationTenantScope(organizationId);
    const role = await this.roleRepo.findById(organizationId, roleId);
    if (!role) {
      throw BusinessError.notFound('Organization role', roleId);
    }
    return role;
  }

  async create(
    organizationId: string,
    dto: UpsertOrganizationRoleDto,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<BetterAuthOrganizationRole> {
    await this.assertOrganizationTenantScope(organizationId);
    this.assertRoleName(dto.role);

    const api = this.authService.api as any;

    const result = await api.createOrgRole({
      body: {
        organizationId,
        role: dto.role,
        permission: dto.permission,
        additionalFields: {
          permissionScopes: JSON.stringify(dto.permissionScopes ?? {}),
        },
      },
      headers,
    });

    this.eventEmitter.emit('rbac.cache.invalidate', { orgId: organizationId });

    return result.roleData;
  }

  async update(
    organizationId: string,
    roleId: string,
    dto: UpsertOrganizationRoleDto,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<BetterAuthOrganizationRole> {
    const existing = await this.getById(organizationId, roleId);
    if (existing.role === RESERVED_OWNER) {
      throw BusinessError.forbidden(
        'Role owner tidak dapat diubah',
        'OWNER_ROLE_IMMUTABLE',
      );
    }

    const api = this.authService.api as any;

    const data: {
      permission?: Record<string, string[]>;
      roleName?: string;
      permissionScopes?: string;
    } = {
      permission: dto.permission,
      permissionScopes: JSON.stringify(dto.permissionScopes ?? {}),
    };

    if (dto.role && dto.role.toLowerCase() !== existing.role) {
      this.assertRoleName(dto.role);
      data.roleName = dto.role;
    }

    const updated = await api.updateOrgRole({
      body: {
        organizationId,
        roleId,
        data,
      },
      headers,
    });

    this.eventEmitter.emit('rbac.cache.invalidate', { orgId: organizationId });

    return updated;
  }

  async remove(
    organizationId: string,
    roleId: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const existing = await this.getById(organizationId, roleId);
    if (existing.role === RESERVED_OWNER) {
      throw BusinessError.forbidden(
        'Role owner tidak dapat dihapus',
        'OWNER_ROLE_IMMUTABLE',
      );
    }

    const api = this.authService.api as any;

    await api.deleteOrgRole({
      body: { organizationId, roleId },
      headers,
    });

    this.eventEmitter.emit('rbac.cache.invalidate', { orgId: organizationId });
  }

  async listForTenant(
    tenantId: string,
    organizationId: string,
  ): Promise<OrganizationRole[]> {
    await this.requireOrganizationInTenant(tenantId, organizationId);
    return this.roleRepo.findByOrganization(organizationId);
  }

  async createForTenant(
    tenantId: string,
    organizationId: string,
    dto: UpsertOrganizationRoleDto,
  ): Promise<OrganizationRole> {
    await this.requireOrganizationInTenant(tenantId, organizationId);
    this.assertRoleName(dto.role);
    const role = dto.role.trim().toLowerCase();
    const existing = await this.roleRepo.findByOrganizationAndRoleName(
      organizationId,
      role,
    );
    if (existing) {
      throw BusinessError.conflict(
        `Role '${role}' sudah ada di organisasi ini`,
        'ORG_ROLE_EXISTS',
      );
    }

    const normalized = await this.permissionService.normalizePermission(
      tenantId,
      dto.permission,
      dto.permissionScopes,
    );
    const created = await this.roleRepo.insert({
      id: randomUUID(),
      tenantId,
      organizationId,
      role,
      permission: JSON.stringify(normalized.permission),
      permissionScopes: JSON.stringify(normalized.permissionScopes),
    });
    this.eventEmitter.emit('rbac.cache.invalidate', { orgId: organizationId });
    return created;
  }

  async updateForTenant(
    tenantId: string,
    organizationId: string,
    roleId: string,
    dto: UpsertOrganizationRoleDto,
  ): Promise<OrganizationRole> {
    await this.requireOrganizationInTenant(tenantId, organizationId);
    const existing = await this.getById(organizationId, roleId);
    if (existing.role === RESERVED_OWNER) {
      throw BusinessError.forbidden(
        'Role owner tidak dapat diubah',
        'OWNER_ROLE_IMMUTABLE',
      );
    }

    const role = dto.role.trim().toLowerCase();
    if (role !== existing.role) {
      this.assertRoleName(role);
      const duplicate = await this.roleRepo.findByOrganizationAndRoleName(
        organizationId,
        role,
      );
      if (duplicate && duplicate.id !== existing.id) {
        throw BusinessError.conflict(
          `Role '${role}' sudah ada di organisasi ini`,
          'ORG_ROLE_EXISTS',
        );
      }
    }

    const normalized = await this.permissionService.normalizePermission(
      tenantId,
      dto.permission,
      dto.permissionScopes,
    );
    const updated = await this.roleRepo.updateById(organizationId, roleId, {
      role,
      permission: JSON.stringify(normalized.permission),
      permissionScopes: JSON.stringify(normalized.permissionScopes),
    });
    if (!updated) {
      throw BusinessError.notFound('Organization role', roleId);
    }
    this.eventEmitter.emit('rbac.cache.invalidate', { orgId: organizationId });
    return updated;
  }

  async removeForTenant(
    tenantId: string,
    organizationId: string,
    roleId: string,
  ): Promise<void> {
    await this.requireOrganizationInTenant(tenantId, organizationId);
    const existing = await this.getById(organizationId, roleId);
    if (existing.role === RESERVED_OWNER) {
      throw BusinessError.forbidden(
        'Role owner tidak dapat dihapus',
        'OWNER_ROLE_IMMUTABLE',
      );
    }
    const deleted = await this.roleRepo.deleteById(organizationId, roleId);
    if (!deleted) {
      throw BusinessError.notFound('Organization role', roleId);
    }
    this.eventEmitter.emit('rbac.cache.invalidate', { orgId: organizationId });
  }

  async assertAssignableRole(
    organizationId: string,
    roleName: string,
  ): Promise<void> {
    await this.assertOrganizationTenantScope(organizationId);
    const normalized = roleName.toLowerCase();
    if (normalized === RESERVED_OWNER) {
      throw BusinessError.forbidden(
        'Tidak dapat menetapkan role owner melalui API',
        'OWNER_ROLE_NOT_ASSIGNABLE',
      );
    }

    const role = await this.roleRepo.findByOrganizationAndRoleName(
      organizationId,
      normalized,
    );

    if (!role) {
      throw BusinessError.unprocessable(
        `Role "${normalized}" tidak terdaftar di organisasi ini`,
        'UNKNOWN_ORG_ROLE',
      );
    }
  }

  private async assertOrganizationTenantScope(
    organizationId: string,
  ): Promise<void> {
    const ctx = TenantContextStorage.get();
    if (!ctx?.tenantId || ctx.source === 'platform') {
      return;
    }
    if (!this.roleRepo.findOrganizationTenantId) {
      return;
    }

    const orgTenantId =
      await this.roleRepo.findOrganizationTenantId(organizationId);
    if (!orgTenantId) {
      throw BusinessError.notFound('Organization', organizationId);
    }
    if (orgTenantId !== ctx.tenantId) {
      throw BusinessError.forbidden(
        'Organisasi tidak termasuk dalam tenant yang aktif pada request ini.',
        'CROSS_TENANT_ORGANIZATION',
      );
    }
  }

  private async requireOrganizationInTenant(
    tenantId: string,
    organizationId: string,
  ): Promise<void> {
    await this.assertOrganizationTenantScope(organizationId);
    if (!this.roleRepo.findOrganizationTenantId) {
      throw BusinessError.internal(
        'Repository role organisasi tidak dapat memeriksa tenant.',
      );
    }
    const orgTenantId =
      await this.roleRepo.findOrganizationTenantId(organizationId);
    if (!orgTenantId) {
      throw BusinessError.notFound('Organization', organizationId);
    }
    if (orgTenantId !== tenantId) {
      throw BusinessError.forbidden(
        'Organisasi tidak termasuk dalam tenant ini.',
        'CROSS_TENANT_ORGANIZATION',
      );
    }
  }

  private assertRoleName(role: string): void {
    const normalized = role.trim().toLowerCase();
    if (!normalized || normalized === RESERVED_OWNER) {
      throw BusinessError.unprocessable(
        'Nama role tidak valid',
        'INVALID_ROLE_NAME',
      );
    }
  }
}
