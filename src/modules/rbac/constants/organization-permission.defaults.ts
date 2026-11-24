/**
 * Katalog default permission organisasi.
 * Resource mengikuti modul shell tenant dan kemampuan organisasi yang dipakai Better Auth.
 */

export interface OrganizationPermissionActionDefault {
  action: string;
  displayName: string;
  description: string;
}

export interface OrganizationPermissionResourceDefault {
  resource: string;
  displayName: string;
  description: string;
  actions: OrganizationPermissionActionDefault[];
}

export const DEFAULT_ORGANIZATION_CATALOG: OrganizationPermissionResourceDefault[] =
  [
    {
      resource: 'settings',
      displayName: 'Pengaturan',
      description: 'Pengaturan tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat pengaturan',
          description: 'Melihat pengaturan tenant',
        },
        {
          action: 'update',
          displayName: 'Ubah pengaturan',
          description: 'Mengubah pengaturan tenant',
        },
      ],
    },
    {
      resource: 'feature',
      displayName: 'Fitur IAM',
      description: 'Fitur login yang diaktifkan tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat fitur',
          description: 'Melihat status fitur IAM tenant',
        },
        {
          action: 'update',
          displayName: 'Ubah fitur',
          description: 'Mengubah fitur IAM yang aktif',
        },
      ],
    },
    {
      resource: 'oauthClient',
      displayName: 'Aplikasi terhubung',
      description: 'OAuth client yang terhubung ke tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat aplikasi',
          description: 'Melihat OAuth client tenant',
        },
        {
          action: 'create',
          displayName: 'Daftarkan aplikasi',
          description: 'Mendaftarkan OAuth client',
        },
        {
          action: 'delete',
          displayName: 'Cabut aplikasi',
          description: 'Menghapus OAuth client',
        },
      ],
    },
    {
      resource: 'apiKey',
      displayName: 'API key',
      description: 'API key milik tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat API key',
          description: 'Melihat API key tenant',
        },
        {
          action: 'create',
          displayName: 'Buat API key',
          description: 'Menerbitkan API key',
        },
        {
          action: 'delete',
          displayName: 'Cabut API key',
          description: 'Mencabut API key',
        },
      ],
    },
    {
      resource: 'user',
      displayName: 'Users',
      description: 'Pengguna yang terdaftar di tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat user',
          description: 'Melihat daftar user tenant',
        },
      ],
    },
    {
      resource: 'organization',
      displayName: 'Organizations',
      description: 'Organisasi di dalam tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat organisasi',
          description: 'Melihat daftar organisasi',
        },
        {
          action: 'update',
          displayName: 'Ubah organisasi',
          description: 'Mengubah data organisasi',
        },
        {
          action: 'delete',
          displayName: 'Hapus organisasi',
          description: 'Menghapus organisasi',
        },
      ],
    },
    {
      resource: 'member',
      displayName: 'Anggota',
      description: 'Keanggotaan di dalam organisasi.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat anggota',
          description: 'Melihat anggota organisasi',
        },
        {
          action: 'create',
          displayName: 'Tambah anggota',
          description: 'Menambahkan anggota',
        },
        {
          action: 'invite',
          displayName: 'Undang anggota',
          description: 'Mengundang anggota baru',
        },
        {
          action: 'update',
          displayName: 'Ubah anggota',
          description: 'Mengubah data anggota',
        },
        {
          action: 'update-role',
          displayName: 'Ubah role anggota',
          description: 'Mengganti role anggota',
        },
        {
          action: 'remove',
          displayName: 'Keluarkan anggota',
          description: 'Mengeluarkan anggota',
        },
        {
          action: 'delete',
          displayName: 'Hapus anggota',
          description: 'Menghapus keanggotaan',
        },
      ],
    },
    {
      resource: 'invitation',
      displayName: 'Undangan',
      description: 'Undangan masuk ke organisasi.',
      actions: [
        {
          action: 'create',
          displayName: 'Buat undangan',
          description: 'Membuat undangan organisasi',
        },
        {
          action: 'cancel',
          displayName: 'Batalkan undangan',
          description: 'Membatalkan undangan',
        },
      ],
    },
    {
      resource: 'team',
      displayName: 'Tim',
      description: 'Tim di dalam organisasi.',
      actions: [
        {
          action: 'create',
          displayName: 'Buat tim',
          description: 'Membuat tim',
        },
        {
          action: 'update',
          displayName: 'Ubah tim',
          description: 'Mengubah tim',
        },
        {
          action: 'delete',
          displayName: 'Hapus tim',
          description: 'Menghapus tim',
        },
      ],
    },
    {
      resource: 'billing',
      displayName: 'Billing',
      description: 'Tagihan Auth Core milik tenant.',
      actions: [
        {
          action: 'read',
          displayName: 'Lihat billing',
          description: 'Melihat status tagihan tenant',
        },
      ],
    },
    {
      resource: 'ac',
      displayName: 'Role organisasi',
      description:
        'Role kustom organisasi. Kunci ac dipakai Better Auth untuk dynamic access control.',
      actions: [
        {
          action: 'create',
          displayName: 'Buat role',
          description: 'Membuat role organisasi',
        },
        {
          action: 'read',
          displayName: 'Lihat role',
          description: 'Melihat role organisasi',
        },
        {
          action: 'update',
          displayName: 'Ubah role',
          description: 'Mengubah role organisasi',
        },
        {
          action: 'delete',
          displayName: 'Hapus role',
          description: 'Menghapus role organisasi',
        },
      ],
    },
  ];

export function defaultOrganizationStatement(): Record<string, readonly string[]> {
  return Object.fromEntries(
    DEFAULT_ORGANIZATION_CATALOG.map((resource) => [
      resource.resource,
      resource.actions.map((action) => action.action),
    ]),
  );
}

function actionsOf(resource: string): string[] {
  return (
    DEFAULT_ORGANIZATION_CATALOG.find((item) => item.resource === resource)
      ?.actions.map((action) => action.action) ?? []
  );
}

function except(resource: string, omitted: string[]): string[] {
  const skip = new Set(omitted);
  return actionsOf(resource).filter((action) => !skip.has(action));
}

export function defaultOrganizationRolePermissions(): Record<
  string,
  Record<string, string[]>
> {
  const owner = Object.fromEntries(
    DEFAULT_ORGANIZATION_CATALOG.map((resource) => [
      resource.resource,
      resource.actions.map((action) => action.action),
    ]),
  );

  return {
    owner,
    admin: {
      settings: actionsOf('settings'),
      feature: actionsOf('feature'),
      oauthClient: actionsOf('oauthClient'),
      apiKey: actionsOf('apiKey'),
      user: actionsOf('user'),
      organization: except('organization', ['delete']),
      member: actionsOf('member'),
      invitation: actionsOf('invitation'),
      team: actionsOf('team'),
      billing: actionsOf('billing'),
      ac: actionsOf('ac'),
    },
    member: {
      settings: ['read'],
      feature: ['read'],
      user: ['read'],
      organization: ['read'],
      member: ['read'],
      billing: ['read'],
      ac: ['read'],
    },
  };
}
