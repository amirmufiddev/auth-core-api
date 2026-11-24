import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '@/common/errors/business-error';
import type { OrganizationRoleTemplate } from '@/database/schema';
import { RbacRoleTemplateRepository } from '../repositories/rbac-role-template.repository';

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

export interface UpsertOrganizationRoleTemplateInput {
  roleName: string;
  permission: Record<string, string[]>;
  permissionScopes?: Record<string, string>;
}

@Injectable()
export class OrganizationRoleTemplateService {
  constructor(
    @Inject(RbacRoleTemplateRepository)
    private readonly templateRepo: RbacRoleTemplateRepository,
  ) {}

  list(tenantId: string): Promise<OrganizationRoleTemplate[]> {
    return this.templateRepo.findByTenant(tenantId);
  }

  async create(
    tenantId: string,
    input: UpsertOrganizationRoleTemplateInput,
  ): Promise<OrganizationRoleTemplate> {
    this.assertRoleName(input.roleName);
    const existing = await this.templateRepo.findByTenantAndRole(
      tenantId,
      input.roleName,
    );
    if (existing) {
      throw BusinessError.conflict(
        `Template role '${input.roleName}' sudah ada`,
        'ROLE_TEMPLATE_EXISTS',
      );
    }

    return this.templateRepo.create({
      tenantId,
      roleName: input.roleName,
      permission: JSON.stringify(input.permission),
      permissionScopes: JSON.stringify(input.permissionScopes ?? {}),
    });
  }

  async update(
    tenantId: string,
    roleName: string,
    input: UpsertOrganizationRoleTemplateInput,
  ): Promise<OrganizationRoleTemplate> {
    this.assertRoleName(roleName);
    const updated = await this.templateRepo.update(tenantId, roleName, {
      permission: JSON.stringify(input.permission),
      permissionScopes: JSON.stringify(input.permissionScopes ?? {}),
    });
    if (!updated) {
      throw BusinessError.notFound('Role template', roleName);
    }
    return updated;
  }

  async remove(tenantId: string, roleName: string): Promise<void> {
    if (roleName === 'owner') {
      throw BusinessError.badRequest(
        'Template role owner tidak dapat dihapus.',
        'OWNER_TEMPLATE_PROTECTED',
      );
    }
    const deleted = await this.templateRepo.delete(tenantId, roleName);
    if (!deleted) {
      throw BusinessError.notFound('Role template', roleName);
    }
  }

  private assertRoleName(roleName: string): void {
    if (!ROLE_NAME_PATTERN.test(roleName)) {
      throw BusinessError.unprocessable(
        'Nama role harus lowercase alfanumerik (contoh: warehouse_staff)',
        'INVALID_ROLE_TEMPLATE_NAME',
      );
    }
  }
}
