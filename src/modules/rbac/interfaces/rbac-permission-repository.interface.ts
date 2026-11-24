import type {
  NewOrganizationPermission,
  OrganizationPermission,
} from '@/database/schema';

export const RBAC_PERMISSION_REPOSITORY_TOKEN = Symbol(
  'RBAC_PERMISSION_REPOSITORY_TOKEN',
);

export interface IRbacPermissionRepository {
  findAllActiveByTenant(tenantId: string): Promise<OrganizationPermission[]>;
  findByResourceAndAction(
    tenantId: string,
    resource: string,
    action: string,
  ): Promise<OrganizationPermission | undefined>;
  findActiveById(
    tenantId: string,
    id: string,
  ): Promise<OrganizationPermission | undefined>;
  createPermission(
    data: NewOrganizationPermission,
  ): Promise<OrganizationPermission>;
  updatePermission(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<
        OrganizationPermission,
        | 'actionDisplayName'
        | 'actionDescription'
        | 'resourceDisplayName'
        | 'resourceDescription'
      >
    >,
  ): Promise<OrganizationPermission | undefined>;
  softDeleteForTenant(tenantId: string, id: string): Promise<boolean>;
}
