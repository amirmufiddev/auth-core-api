import { BadRequestException } from '@nestjs/common';

/**
 * Katalog permission platform. Pasangan console:
 * auth-core-console/src/config/platform-permissions.ts
 * Modul yang tampil di matriks role mengikuti menu console.
 * Resource tersembunyi tetap ada untuk endpoint yang belum punya menu sendiri.
 */
export interface PlatformPermissionDefinition {
  action: string;
  label: string;
  description: string;
}

export interface PlatformPermissionModule {
  resource: string;
  title: string;
  description: string;
  shownInPlatformMatrix: boolean;
  permissions: PlatformPermissionDefinition[];
}

export const PLATFORM_PERMISSION_CATALOG: PlatformPermissionModule[] = [
  {
    resource: 'tenant',
    title: 'Tenants',
    description: 'Daftar tenant, pembuatan, perubahan tier, dan status.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat tenant', description: 'Melihat daftar dan detail tenant' },
      { action: 'create', label: 'Buat tenant', description: 'Membuat tenant baru' },
      { action: 'update', label: 'Ubah tenant', description: 'Mengubah data, tier, dan status tenant' },
    ],
  },
  {
    resource: 'tier',
    title: 'Feature & Tier Matrix',
    description: 'Katalog fitur dan matriks tier Auth Core.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat matriks', description: 'Melihat katalog fitur dan tier' },
      { action: 'update', label: 'Ubah matriks', description: 'Mengubah status fitur dan isi tier' },
    ],
  },
  {
    resource: 'billing',
    title: 'Billing Ledger',
    description: 'Catatan tagihan tenant.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat billing', description: 'Membaca ledger billing' },
      { action: 'create', label: 'Catat billing', description: 'Menambah entri billing' },
    ],
  },
  {
    resource: 'user',
    title: 'Direktori akun',
    description: 'Pencarian seluruh akun operator dan pengguna tenant.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat direktori', description: 'Melihat seluruh akun' },
      { action: 'impersonate', label: 'Impersonate', description: 'Masuk sebagai user untuk dukungan' },
    ],
  },
  {
    resource: 'staff',
    title: 'Staf platform',
    description: 'Akun operator Auth Core.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat staf', description: 'Melihat akun staf platform' },
      { action: 'create', label: 'Buat staf', description: 'Membuat akun staf' },
      { action: 'update', label: 'Ubah staf', description: 'Mengubah profil staf' },
      { action: 'delete', label: 'Hapus staf', description: 'Menghapus akun staf' },
      { action: 'ban', label: 'Ban / Unban', description: 'Membekukan atau memulihkan staf' },
    ],
  },
  {
    resource: 'role',
    title: 'Role platform',
    description: 'Definisi role dan matriks permission platform.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat role', description: 'Melihat role platform' },
      { action: 'create', label: 'Buat role', description: 'Menambah role platform' },
      { action: 'update', label: 'Ubah role', description: 'Mengubah permission role' },
      { action: 'delete', label: 'Hapus role', description: 'Menghapus role kustom' },
    ],
  },
  {
    resource: 'session',
    title: 'Sesi staf',
    description: 'Sesi aktif perangkat staf.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat sesi', description: 'Melihat sesi aktif' },
      { action: 'revoke', label: 'Cabut sesi', description: 'Mencabut sesi secara paksa' },
    ],
  },
  {
    resource: 'auditLog',
    title: 'Audit platform',
    description: 'Jejak audit autentikasi dan konfigurasi.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Baca audit', description: 'Membaca event audit' },
      { action: 'export', label: 'Ekspor audit', description: 'Mengekspor log audit' },
    ],
  },
  {
    resource: 'authFeature',
    title: 'Auth Features',
    description: 'Plugin login dan parameter runtime platform.',
    shownInPlatformMatrix: true,
    permissions: [
      { action: 'read', label: 'Lihat plugin', description: 'Melihat status plugin Auth Core' },
      { action: 'configure', label: 'Ubah plugin', description: 'Mengubah plugin dan parameternya' },
    ],
  },
  {
    resource: 'organization',
    title: 'Organizations',
    description: 'API organisasi platform yang belum punya menu sendiri.',
    shownInPlatformMatrix: false,
    permissions: [
      { action: 'read', label: 'Lihat organisasi', description: 'Melihat organisasi' },
      { action: 'create', label: 'Buat organisasi', description: 'Membuat organisasi' },
      { action: 'update', label: 'Ubah organisasi', description: 'Mengubah organisasi dan undangan' },
      { action: 'delete', label: 'Hapus organisasi', description: 'Menghapus organisasi' },
    ],
  },
  {
    resource: 'apiKey',
    title: 'API Keys',
    description: 'API key yang dikelola dari endpoint platform.',
    shownInPlatformMatrix: false,
    permissions: [
      { action: 'read', label: 'Lihat API key', description: 'Melihat API key' },
      { action: 'create', label: 'Buat API key', description: 'Menerbitkan API key' },
      { action: 'update', label: 'Ubah API key', description: 'Mengaktifkan atau menonaktifkan API key' },
      { action: 'revoke', label: 'Cabut API key', description: 'Mencabut API key' },
    ],
  },
  {
    resource: 'oauthClient',
    title: 'OAuth clients',
    description: 'OAuth client yang dikelola dari endpoint platform.',
    shownInPlatformMatrix: false,
    permissions: [
      { action: 'read', label: 'Lihat client', description: 'Melihat OAuth client' },
      { action: 'create', label: 'Daftarkan client', description: 'Mendaftarkan client' },
      { action: 'update', label: 'Ubah client', description: 'Mengubah client' },
      { action: 'delete', label: 'Hapus client', description: 'Menghapus client' },
    ],
  },
  {
    resource: 'sso',
    title: 'SSO',
    description: 'Provider SSO yang dikelola dari endpoint platform.',
    shownInPlatformMatrix: false,
    permissions: [
      { action: 'read', label: 'Lihat SSO', description: 'Melihat provider SSO' },
      { action: 'configure', label: 'Ubah SSO', description: 'Mengubah provider SSO' },
      { action: 'delete', label: 'Hapus SSO', description: 'Menghapus provider SSO' },
    ],
  },
];

const ACTIONS_BY_RESOURCE = new Map(
  PLATFORM_PERMISSION_CATALOG.map((mod) => [
    mod.resource,
    new Set(mod.permissions.map((permission) => permission.action)),
  ]),
);

export function assertPlatformPermissionMatrix(
  permissions: Record<string, string[]> | null | undefined,
): void {
  for (const [resource, actions] of Object.entries(permissions ?? {})) {
    if (!Array.isArray(actions)) {
      throw new BadRequestException(
        `Permission resource '${resource}' harus berupa daftar action.`,
      );
    }
    const allowed = ACTIONS_BY_RESOURCE.get(resource);
    if (!allowed) {
      throw new BadRequestException(
        `Resource platform '${resource}' tidak ada di katalog.`,
      );
    }
    for (const action of actions) {
      if (!allowed.has(action)) {
        throw new BadRequestException(
          `Permission '${resource}:${action}' tidak ada di katalog platform.`,
        );
      }
    }
  }
}
