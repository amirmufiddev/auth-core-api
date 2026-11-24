import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/database/schema';
import { DEFAULT_ORGANIZATION_CATALOG } from '@/modules/rbac/constants/organization-permission.defaults';
import {
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

  for (const resource of DEFAULT_ORGANIZATION_CATALOG) {
    for (const action of resource.actions) {
      rows.push({
        resource: resource.resource,
        action: action.action,
        actionDisplayName: action.displayName,
        actionDescription: action.description,
        resourceDisplayName: resource.displayName,
        resourceDescription: resource.description,
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

export async function seedOrganizationCatalogForTenant(
  db: NodePgDatabase<typeof schema>,
  tenantId: string,
): Promise<void> {
  for (const perm of buildRbacPermissionRows()) {
    const existing = await db
      .select({ id: schema.organizationPermission.id })
      .from(schema.organizationPermission)
      .where(
        and(
          eq(schema.organizationPermission.tenantId, tenantId),
          eq(schema.organizationPermission.resource, perm.resource),
          eq(schema.organizationPermission.action, perm.action),
          isNull(schema.organizationPermission.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(schema.organizationPermission).values({
      tenantId,
      resource: perm.resource,
      action: perm.action,
      actionDisplayName: perm.actionDisplayName,
      actionDescription: perm.actionDescription,
      resourceDisplayName: perm.resourceDisplayName,
      resourceDescription: perm.resourceDescription,
    });
  }

  for (const tmpl of buildRbacRoleTemplateRows()) {
    await db
      .insert(schema.organizationRoleTemplate)
      .values({
        tenantId,
        roleName: tmpl.roleName,
        permission: tmpl.permission,
        permissionScopes: tmpl.permissionScopes,
      })
      .onConflictDoNothing();
  }
}

export const rbacSeeder: Seeder = {
  name: 'rbac',
  async run({ pool }: SeederContext): Promise<void> {
    // Katalog organisasi diisi per tenant lewat seedOrganizationCatalogForTenant.
    // Seeder global hanya menyiapkan role platform.
    const defaultConsoleRoles = [
      {
        id: 'role_super_admin',
        name: 'Super Admin',
        slug: 'super_admin',
        description:
          'Akses penuh ke seluruh layanan Auth Core, RBAC, dan konfigurasi layanan autentikasi.',
        isSystem: true,
        permissions: {
          tenant: ['read', 'create', 'update'],
          tier: ['read', 'update'],
          billing: ['read', 'create'],
          user: ['read', 'impersonate'],
          staff: ['read', 'create', 'update', 'delete', 'ban'],
          session: ['read', 'revoke'],
          role: ['read', 'create', 'update', 'delete'],
          authFeature: ['read', 'configure'],
          organization: ['read', 'create', 'update', 'delete'],
          apiKey: ['read', 'create', 'update', 'revoke'],
          oauthClient: ['read', 'create', 'update', 'delete'],
          sso: ['read', 'configure', 'delete'],
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
          tenant: ['read', 'create', 'update'],
          tier: ['read', 'update'],
          billing: ['read', 'create'],
          user: ['read', 'impersonate'],
          staff: ['read', 'create', 'update', 'delete', 'ban'],
          session: ['read', 'revoke'],
          role: ['read', 'create', 'update', 'delete'],
          authFeature: ['read', 'configure'],
          organization: ['read', 'create', 'update', 'delete'],
          apiKey: ['read', 'create', 'update', 'revoke'],
          oauthClient: ['read', 'create', 'update', 'delete'],
          sso: ['read', 'configure', 'delete'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_security_admin',
        name: 'Security Admin',
        slug: 'security_admin',
        description:
          'Mengelola sesi staf, pembekuan akun, plugin login platform, dan audit. API key serta aplikasi pelanggan diatur pemilik tenant.',
        isSystem: true,
        permissions: {
          tenant: ['read'],
          tier: ['read', 'update'],
          billing: ['read'],
          user: ['read'],
          staff: ['read', 'update', 'ban'],
          session: ['read', 'revoke'],
          role: ['read'],
          authFeature: ['read', 'configure'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_org_manager',
        name: 'Org Manager',
        slug: 'org_manager',
        description:
          'Membuat tenant, mengubah status dan tier, serta membaca staf dan audit platform.',
        isSystem: false,
        permissions: {
          tenant: ['read', 'create', 'update'],
          tier: ['read', 'update'],
          billing: ['read'],
          user: ['read'],
          staff: ['read'],
          session: ['read'],
          role: ['read'],
          auditLog: ['read'],
        },
      },
      {
        id: 'role_support_agent',
        name: 'Support Agent',
        slug: 'support_agent',
        description:
          'Mencari akun di direktori, masuk sebagai pengguna, dan mencabut sesi. Melihat tenant dalam mode dukungan.',
        isSystem: false,
        permissions: {
          tenant: ['read'],
          user: ['read', 'impersonate'],
          session: ['read', 'revoke'],
          auditLog: ['read'],
        },
      },
      {
        id: 'role_auditor',
        name: 'Compliance Auditor',
        slug: 'auditor',
        description:
          'Membaca direktori akun, role, sesi, tenant, dan plugin, lalu mengekspor audit platform.',
        isSystem: false,
        permissions: {
          tenant: ['read'],
          tier: ['read'],
          billing: ['read'],
          user: ['read'],
          staff: ['read'],
          session: ['read'],
          role: ['read'],
          authFeature: ['read'],
          auditLog: ['read', 'export'],
        },
      },
      {
        id: 'role_user',
        name: 'Standard User',
        slug: 'user',
        description:
          'Akun pelanggan. Mengelola tenant yang ia miliki dari shell tenant.',
        isSystem: true,
        permissions: {},
      },
    ];

    for (const roleRow of defaultConsoleRoles) {
      await pool.query(
        `
        INSERT INTO "auth_core_role" ("id", "name", "slug", "description", "is_system", "permissions", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
        ON CONFLICT ("slug") DO UPDATE
          SET "description" = EXCLUDED.description,
              "permissions" = EXCLUDED.permissions,
              "updated_at" = now();
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
