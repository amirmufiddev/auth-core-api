import {
  BOOTSTRAP_BETTER_AUTH_STATEMENT,
  getDefaultRolePermissions,
  getDefaultPermissionScopes,
} from '@/modules/rbac/constants/permissions.constant';
import type { Seeder, SeederContext } from './seeder.interface';

export function buildRbacPermissionRows(): Array<{
  resource: string;
  action: string;
  actionDisplayName: string;
  actionDescription: string;
  resourceDisplayName: string;
  resourceDescription: string;
}> {
  const rows: Array<{
    resource: string;
    action: string;
    actionDisplayName: string;
    actionDescription: string;
    resourceDisplayName: string;
    resourceDescription: string;
  }> = [];

  for (const [resource, actions] of Object.entries(
    BOOTSTRAP_BETTER_AUTH_STATEMENT,
  )) {
    for (const action of actions) {
      rows.push({
        resource,
        action,
        actionDisplayName: action,
        actionDescription: `Permission to ${action} ${resource}`,
        resourceDisplayName: resource,
        resourceDescription: `Resource ${resource}`,
      });
    }
  }

  return rows;
}

export function buildRbacRoleTemplateRows(): Array<{
  roleName: string;
  permission: string;
  permissionScopes: string;
}> {
  const rolePermissions = getDefaultRolePermissions();
  const roleScopes = getDefaultPermissionScopes();

  const roleNames = Array.from(
    new Set([...Object.keys(rolePermissions), ...Object.keys(roleScopes)]),
  );

  return roleNames.map((roleName) => ({
    roleName,
    permission: JSON.stringify(rolePermissions[roleName] ?? {}),
    permissionScopes: JSON.stringify(roleScopes[roleName] ?? {}),
  }));
}

export const rbacSeeder: Seeder = {
  name: 'rbac',
  async run({ pool }: SeederContext): Promise<void> {
    const permissions = buildRbacPermissionRows();
    const roleTemplates = buildRbacRoleTemplateRows();

    // Insert permissions (active unique index uq_rbac_permission_resource_action_active where deleted_at is null)
    for (const perm of permissions) {
      await pool.query(
        `
        INSERT INTO "rbac_permission" (
          "resource",
          "action",
          "action_display_name",
          "action_description",
          "resource_display_name",
          "resource_description"
        )
        SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM "rbac_permission"
          WHERE "resource" = $1 AND "action" = $2 AND "deleted_at" IS NULL
        );
        `,
        [
          perm.resource,
          perm.action,
          perm.actionDisplayName,
          perm.actionDescription,
          perm.resourceDisplayName,
          perm.resourceDescription,
        ],
      );
    }

    // Insert or update role templates
    for (const tmpl of roleTemplates) {
      await pool.query(
        `
        INSERT INTO "rbac_role_template" ("role_name", "permission", "permission_scopes", "created_at", "updated_at")
        VALUES ($1, $2, $3, now(), now())
        ON CONFLICT ("role_name") DO UPDATE
          SET "permission" = EXCLUDED.permission,
              "permission_scopes" = EXCLUDED.permission_scopes,
              "updated_at" = now();
        `,
        [tmpl.roleName, tmpl.permission, tmpl.permissionScopes],
      );
    }

    // Insert default Auth Core Console RBAC roles
    const defaultConsoleRoles = [
      {
        id: 'role_super_admin',
        name: 'Super Admin',
        slug: 'super_admin',
        description:
          'Akses penuh ke seluruh layanan Auth Core, RBAC, dan konfigurasi layanan autentikasi.',
        isSystem: true,
        permissions: {
          user: ['read', 'create', 'update', 'delete', 'ban', 'impersonate'],
          session: ['read', 'revoke'],
          role: ['read', 'create', 'update', 'delete'],
          organization: ['read', 'create', 'update', 'delete'],
          apiKey: ['read', 'create', 'update', 'revoke'],
          oauthClient: ['read', 'create', 'update', 'delete'],
          sso: ['read', 'configure', 'delete'],
          authConfig: ['read', 'configure'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_admin',
        name: 'Administrator',
        slug: 'admin',
        description:
          'Administrator sistem bawaan dengan akses penuh ke konsol IAM.',
        isSystem: true,
        permissions: {
          user: ['read', 'create', 'update', 'delete', 'ban', 'impersonate'],
          session: ['read', 'revoke'],
          role: ['read', 'create', 'update', 'delete'],
          organization: ['read', 'create', 'update', 'delete'],
          apiKey: ['read', 'create', 'update', 'revoke'],
          oauthClient: ['read', 'create', 'update', 'delete'],
          sso: ['read', 'configure', 'delete'],
          authConfig: ['read', 'configure'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_security_admin',
        name: 'Security Admin',
        slug: 'security_admin',
        description:
          'Mengelola kebijakan 2FA, sesi aktif, API Key, SSO, dan audit log.',
        isSystem: true,
        permissions: {
          user: ['read', 'update', 'ban'],
          session: ['read', 'revoke'],
          role: ['read'],
          organization: ['read'],
          apiKey: ['read', 'create', 'update', 'revoke'],
          oauthClient: ['read', 'update'],
          sso: ['read', 'configure'],
          authConfig: ['read', 'configure'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_org_manager',
        name: 'Org Manager',
        slug: 'org_manager',
        description:
          'Mengelola tenant organisasi, tim, undangan member, dan kuota user.',
        isSystem: false,
        permissions: {
          user: ['read', 'create', 'update'],
          session: ['read'],
          role: ['read'],
          organization: ['read', 'create', 'update'],
          apiKey: ['read'],
          auditLog: ['read'],
        },
      },
      {
        id: 'role_support_agent',
        name: 'Support Agent',
        slug: 'support_agent',
        description:
          'Membantu troubleshooting user termasuk impersonation & pencabutan sesi.',
        isSystem: false,
        permissions: {
          user: ['read', 'update', 'impersonate'],
          session: ['read', 'revoke'],
          organization: ['read'],
          auditLog: ['read'],
        },
      },
      {
        id: 'role_auditor',
        name: 'Compliance Auditor',
        slug: 'auditor',
        description:
          'Akses read-only ke user, role, SSO, konfigurasi, dan ekspor audit log.',
        isSystem: false,
        permissions: {
          user: ['read'],
          session: ['read'],
          role: ['read'],
          organization: ['read'],
          apiKey: ['read'],
          oauthClient: ['read'],
          sso: ['read'],
          authConfig: ['read'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_user',
        name: 'Standard User',
        slug: 'user',
        description:
          'Role default pengguna aplikasi tanpa hak akses konsol admin.',
        isSystem: true,
        permissions: {},
      },
    ];

    for (const roleRow of defaultConsoleRoles) {
      await pool.query(
        `
        INSERT INTO "auth_core_role" ("id", "name", "slug", "description", "is_system", "permissions", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
        ON CONFLICT ("slug") DO NOTHING;
        `,
        [
          roleRow.id,
          roleRow.name,
          roleRow.slug,
          roleRow.description,
          roleRow.isSystem,
          JSON.stringify(roleRow.permissions),
        ],
      );
    }
  },
};
