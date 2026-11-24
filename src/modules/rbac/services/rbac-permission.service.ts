import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '@/common/errors/business-error';
import type { OrganizationPermission } from '@/database/schema';
import {
  RBAC_PERMISSION_REPOSITORY_TOKEN,
  type IRbacPermissionRepository,
} from '../interfaces/rbac-permission-repository.interface';
import {
  buildAllPermissionCodes,
  buildPermissionCatalogView,
} from '../utils/rbac-permission.mapper';
import type { CreateRbacPermissionDto } from '../dto/create-rbac-permission.dto';
import type { UpdateRbacPermissionDto } from '../dto/update-rbac-permission.dto';

const RESOURCE_PATTERN = /^[a-z][a-z0-9-]*$/;
const ACTION_PATTERN = /^[a-z][a-z0-9-]*$/;

@Injectable()
export class RbacPermissionService {
  constructor(
    @Inject(RBAC_PERMISSION_REPOSITORY_TOKEN)
    private readonly permissionRepo: IRbacPermissionRepository,
  ) {}

  async getCatalog(tenantId: string) {
    const rows = await this.permissionRepo.findAllActiveByTenant(tenantId);
    return buildPermissionCatalogView(rows);
  }

  async getPermissionCodes(tenantId: string): Promise<string[]> {
    const rows = await this.permissionRepo.findAllActiveByTenant(tenantId);
    return buildAllPermissionCodes(rows);
  }

  async getById(tenantId: string, id: string): Promise<OrganizationPermission> {
    const row = await this.permissionRepo.findActiveById(tenantId, id);
    if (!row) {
      throw BusinessError.notFound('Permission', id);
    }
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateRbacPermissionDto,
  ): Promise<OrganizationPermission> {
    this.assertSlug('resource', dto.resource, RESOURCE_PATTERN);
    this.assertSlug('action', dto.action, ACTION_PATTERN);

    const existing = await this.permissionRepo.findByResourceAndAction(
      tenantId,
      dto.resource,
      dto.action,
    );
    if (existing) {
      throw BusinessError.conflict(
        `Permission ${dto.resource}:${dto.action} sudah ada`,
        'PERMISSION_EXISTS',
      );
    }

    return this.permissionRepo.createPermission({
      tenantId,
      resource: dto.resource,
      action: dto.action,
      actionDisplayName: dto.actionDisplayName,
      actionDescription: dto.actionDescription,
      resourceDisplayName: dto.resourceDisplayName,
      resourceDescription: dto.resourceDescription,
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRbacPermissionDto,
  ): Promise<OrganizationPermission> {
    await this.getById(tenantId, id);

    const updated = await this.permissionRepo.updatePermission(tenantId, id, {
      actionDisplayName: dto.actionDisplayName,
      actionDescription: dto.actionDescription,
      resourceDisplayName: dto.resourceDisplayName,
      resourceDescription: dto.resourceDescription,
    });

    if (!updated) {
      throw BusinessError.notFound('Permission', id);
    }

    return updated;
  }

  async normalizePermission(
    tenantId: string,
    permission: Record<string, string[]>,
    scopes?: Record<string, string>,
  ): Promise<{
    permission: Record<string, string[]>;
    permissionScopes: Record<string, string>;
  }> {
    const rows = await this.permissionRepo.findAllActiveByTenant(tenantId);
    const allowed = new Set(
      rows.map((row) => `${row.resource}:${row.action}`),
    );
    const normalized: Record<string, string[]> = {};
    const permissionScopes: Record<string, string> = {};

    for (const [resource, actions] of Object.entries(permission ?? {})) {
      if (!Array.isArray(actions)) {
        throw BusinessError.unprocessable(
          'Format permission tidak valid',
          'INVALID_PERMISSION',
        );
      }
      const unique = [
        ...new Set(actions.map((action) => String(action).trim())),
      ].filter(Boolean);
      for (const action of unique) {
        const code = `${resource}:${action}`;
        if (!allowed.has(code)) {
          throw BusinessError.unprocessable(
            `Permission ${code} tidak ada di katalog tenant`,
            'UNKNOWN_PERMISSION',
          );
        }
        permissionScopes[code] = scopes?.[code] ?? 'organization';
      }
      if (unique.length > 0) {
        normalized[resource] = unique;
      }
    }

    return { permission: normalized, permissionScopes };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.getById(tenantId, id);
    const deleted = await this.permissionRepo.softDeleteForTenant(
      tenantId,
      id,
    );
    if (!deleted) {
      throw BusinessError.notFound('Permission', id);
    }
  }

  private assertSlug(field: string, value: string, pattern: RegExp): void {
    if (!pattern.test(value)) {
      throw BusinessError.unprocessable(
        `${field} harus lowercase alfanumerik dengan strip (contoh: update-role)`,
        'INVALID_PERMISSION_SLUG',
      );
    }
  }
}
