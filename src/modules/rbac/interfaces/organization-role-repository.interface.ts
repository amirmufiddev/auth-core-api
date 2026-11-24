import type {
  NewOrganizationRole,
  OrganizationRole,
} from '@/database/schema';

export const ORGANIZATION_ROLE_REPOSITORY_TOKEN = Symbol(
  'ORGANIZATION_ROLE_REPOSITORY_TOKEN',
);

export interface IOrganizationRoleRepository {
  findByOrganization(organizationId: string): Promise<OrganizationRole[]>;
  findByOrganizationAndRoleName(
    organizationId: string,
    roleName: string,
  ): Promise<OrganizationRole | undefined>;
  findById(
    organizationId: string,
    roleId: string,
  ): Promise<OrganizationRole | undefined>;
  findOrganizationTenantId?(organizationId: string): Promise<string | null>;
  insert(row: NewOrganizationRole): Promise<OrganizationRole>;
  updateById(
    organizationId: string,
    roleId: string,
    patch: Partial<
      Pick<OrganizationRole, 'role' | 'permission' | 'permissionScopes'>
    >,
  ): Promise<OrganizationRole | undefined>;
  deleteById(organizationId: string, roleId: string): Promise<boolean>;
}
