import {
  defaultOrganizationRolePermissions,
  defaultOrganizationStatement,
} from './organization-permission.defaults';

/**
 * Bootstrap fallback saat tabel `organization_permission` belum terisi (mis. unit test auth).
 * Produksi memuat statement dari database via `loadBetterAuthStatement`.
 */
export const BOOTSTRAP_BETTER_AUTH_STATEMENT: Record<
  string,
  readonly string[]
> = defaultOrganizationStatement();

/** @deprecated Gunakan RbacPermissionService / database. Hanya untuk backward-compat test. */
export const MASTER_PERMISSIONS = Object.fromEntries(
  Object.entries(BOOTSTRAP_BETTER_AUTH_STATEMENT).map(([resource, actions]) => [
    resource,
    {
      resource,
      displayName: resource,
      actions: Object.fromEntries(
        actions.map((action) => [action, { displayName: action }]),
      ),
    },
  ]),
);

/** @deprecated */
export function getBetterAuthStatement(
  statement: Record<
    string,
    readonly string[]
  > = BOOTSTRAP_BETTER_AUTH_STATEMENT,
): Record<string, readonly string[]> {
  return statement;
}

/** @deprecated */
export function getAllPermissionCodes(): string[] {
  const codes: string[] = [];
  for (const [resource, actions] of Object.entries(
    BOOTSTRAP_BETTER_AUTH_STATEMENT,
  )) {
    for (const action of actions) {
      codes.push(`${resource}:${action}`);
    }
  }
  return codes;
}

/** Template role yang disalin ke organisasi baru. */
export function getDefaultRolePermissions(): Record<
  string,
  Record<string, string[]>
> {
  return defaultOrganizationRolePermissions();
}

/** Scope default tiap kode permission pada template role. */
export function getDefaultPermissionScopes(): Record<
  string,
  Record<string, string>
> {
  const scopes: Record<string, Record<string, string>> = {};
  for (const [roleName, permissions] of Object.entries(
    getDefaultRolePermissions(),
  )) {
    scopes[roleName] = {};
    for (const [resource, actions] of Object.entries(permissions)) {
      for (const action of actions) {
        scopes[roleName][`${resource}:${action}`] = 'organization';
      }
    }
  }
  return scopes;
}
