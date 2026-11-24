export interface CanCreateOrganizationOptions {
  tenantId?: string | null;
}

export function canCreateOrganization(
  membershipRoles: readonly string[],
  options?: CanCreateOrganizationOptions,
): boolean {
  if (options?.tenantId) {
    return true;
  }
  if (membershipRoles.length === 0) {
    return true;
  }
  return membershipRoles.includes('owner');
}
