-- Katalog organisasi default mengikuti modul tenant saat ini.
DELETE FROM "organization_permission";--> statement-breakpoint
DELETE FROM "organization_role_template";--> statement-breakpoint
INSERT INTO "organization_permission" (
  "tenant_id", "resource", "action", "action_display_name", "action_description", "resource_display_name", "resource_description"
)
SELECT t."id", v.resource, v.action, v.action_display_name, v.action_description, v.resource_display_name, v.resource_description
FROM "tenant" t
CROSS JOIN (
  VALUES
    ('settings', 'read', 'Lihat pengaturan', 'Melihat pengaturan tenant', 'Pengaturan', 'Pengaturan tenant.'),
    ('settings', 'update', 'Ubah pengaturan', 'Mengubah pengaturan tenant', 'Pengaturan', 'Pengaturan tenant.'),
    ('feature', 'read', 'Lihat fitur', 'Melihat status fitur IAM tenant', 'Fitur IAM', 'Fitur login yang diaktifkan tenant.'),
    ('feature', 'update', 'Ubah fitur', 'Mengubah fitur IAM yang aktif', 'Fitur IAM', 'Fitur login yang diaktifkan tenant.'),
    ('oauthClient', 'read', 'Lihat aplikasi', 'Melihat OAuth client tenant', 'Aplikasi terhubung', 'OAuth client yang terhubung ke tenant.'),
    ('oauthClient', 'create', 'Daftarkan aplikasi', 'Mendaftarkan OAuth client', 'Aplikasi terhubung', 'OAuth client yang terhubung ke tenant.'),
    ('oauthClient', 'delete', 'Cabut aplikasi', 'Menghapus OAuth client', 'Aplikasi terhubung', 'OAuth client yang terhubung ke tenant.'),
    ('apiKey', 'read', 'Lihat API key', 'Melihat API key tenant', 'API key', 'API key milik tenant.'),
    ('apiKey', 'create', 'Buat API key', 'Menerbitkan API key', 'API key', 'API key milik tenant.'),
    ('apiKey', 'delete', 'Cabut API key', 'Mencabut API key', 'API key', 'API key milik tenant.'),
    ('user', 'read', 'Lihat user', 'Melihat daftar user tenant', 'Users', 'Pengguna yang terdaftar di tenant.'),
    ('organization', 'read', 'Lihat organisasi', 'Melihat daftar organisasi', 'Organizations', 'Organisasi di dalam tenant.'),
    ('organization', 'update', 'Ubah organisasi', 'Mengubah data organisasi', 'Organizations', 'Organisasi di dalam tenant.'),
    ('organization', 'delete', 'Hapus organisasi', 'Menghapus organisasi', 'Organizations', 'Organisasi di dalam tenant.'),
    ('member', 'read', 'Lihat anggota', 'Melihat anggota organisasi', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('member', 'create', 'Tambah anggota', 'Menambahkan anggota', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('member', 'invite', 'Undang anggota', 'Mengundang anggota baru', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('member', 'update', 'Ubah anggota', 'Mengubah data anggota', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('member', 'update-role', 'Ubah role anggota', 'Mengganti role anggota', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('member', 'remove', 'Keluarkan anggota', 'Mengeluarkan anggota', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('member', 'delete', 'Hapus anggota', 'Menghapus keanggotaan', 'Anggota', 'Keanggotaan di dalam organisasi.'),
    ('invitation', 'create', 'Buat undangan', 'Membuat undangan organisasi', 'Undangan', 'Undangan masuk ke organisasi.'),
    ('invitation', 'cancel', 'Batalkan undangan', 'Membatalkan undangan', 'Undangan', 'Undangan masuk ke organisasi.'),
    ('team', 'create', 'Buat tim', 'Membuat tim', 'Tim', 'Tim di dalam organisasi.'),
    ('team', 'update', 'Ubah tim', 'Mengubah tim', 'Tim', 'Tim di dalam organisasi.'),
    ('team', 'delete', 'Hapus tim', 'Menghapus tim', 'Tim', 'Tim di dalam organisasi.'),
    ('billing', 'read', 'Lihat billing', 'Melihat status tagihan tenant', 'Billing', 'Tagihan Auth Core milik tenant.'),
    ('ac', 'create', 'Buat role', 'Membuat role organisasi', 'Role organisasi', 'Role kustom organisasi. Kunci ac dipakai Better Auth untuk dynamic access control.'),
    ('ac', 'read', 'Lihat role', 'Melihat role organisasi', 'Role organisasi', 'Role kustom organisasi. Kunci ac dipakai Better Auth untuk dynamic access control.'),
    ('ac', 'update', 'Ubah role', 'Mengubah role organisasi', 'Role organisasi', 'Role kustom organisasi. Kunci ac dipakai Better Auth untuk dynamic access control.'),
    ('ac', 'delete', 'Hapus role', 'Menghapus role organisasi', 'Role organisasi', 'Role kustom organisasi. Kunci ac dipakai Better Auth untuk dynamic access control.')
) AS v(resource, action, action_display_name, action_description, resource_display_name, resource_description);--> statement-breakpoint
INSERT INTO "organization_role_template" ("tenant_id", "role_name", "permission", "permission_scopes")
SELECT t."id", v.role_name, v.permission::text, v.permission_scopes::text
FROM "tenant" t
CROSS JOIN (
  VALUES
    ('owner', '{"settings":["read","update"],"feature":["read","update"],"oauthClient":["read","create","delete"],"apiKey":["read","create","delete"],"user":["read"],"organization":["read","update","delete"],"member":["read","create","invite","update","update-role","remove","delete"],"invitation":["create","cancel"],"team":["create","update","delete"],"billing":["read"],"ac":["create","read","update","delete"]}'::jsonb, '{"settings:read":"organization","settings:update":"organization","feature:read":"organization","feature:update":"organization","oauthClient:read":"organization","oauthClient:create":"organization","oauthClient:delete":"organization","apiKey:read":"organization","apiKey:create":"organization","apiKey:delete":"organization","user:read":"organization","organization:read":"organization","organization:update":"organization","organization:delete":"organization","member:read":"organization","member:create":"organization","member:invite":"organization","member:update":"organization","member:update-role":"organization","member:remove":"organization","member:delete":"organization","invitation:create":"organization","invitation:cancel":"organization","team:create":"organization","team:update":"organization","team:delete":"organization","billing:read":"organization","ac:create":"organization","ac:read":"organization","ac:update":"organization","ac:delete":"organization"}'::jsonb),
    ('admin', '{"settings":["read","update"],"feature":["read","update"],"oauthClient":["read","create","delete"],"apiKey":["read","create","delete"],"user":["read"],"organization":["read","update"],"member":["read","create","invite","update","update-role","remove","delete"],"invitation":["create","cancel"],"team":["create","update","delete"],"billing":["read"],"ac":["create","read","update","delete"]}'::jsonb, '{"settings:read":"organization","settings:update":"organization","feature:read":"organization","feature:update":"organization","oauthClient:read":"organization","oauthClient:create":"organization","oauthClient:delete":"organization","apiKey:read":"organization","apiKey:create":"organization","apiKey:delete":"organization","user:read":"organization","organization:read":"organization","organization:update":"organization","member:read":"organization","member:create":"organization","member:invite":"organization","member:update":"organization","member:update-role":"organization","member:remove":"organization","member:delete":"organization","invitation:create":"organization","invitation:cancel":"organization","team:create":"organization","team:update":"organization","team:delete":"organization","billing:read":"organization","ac:create":"organization","ac:read":"organization","ac:update":"organization","ac:delete":"organization"}'::jsonb),
    ('member', '{"settings":["read"],"feature":["read"],"user":["read"],"organization":["read"],"member":["read"],"billing":["read"],"ac":["read"]}'::jsonb, '{"settings:read":"organization","feature:read":"organization","user:read":"organization","organization:read":"organization","member:read":"organization","billing:read":"organization","ac:read":"organization"}'::jsonb)
) AS v(role_name, permission, permission_scopes);--> statement-breakpoint
UPDATE "auth_core_role" SET "permissions" = '{"tenant":["read","create","update"],"tier":["read","update"],"billing":["read","create"],"user":["read","impersonate"],"staff":["read","create","update","delete","ban"],"session":["read","revoke"],"role":["read","create","update","delete"],"authFeature":["read","configure"],"organization":["read","create","update","delete"],"apiKey":["read","create","update","revoke"],"oauthClient":["read","create","update","delete"],"sso":["read","configure","delete"],"auditLog":["read","export"]}'::jsonb, "updated_at" = now() WHERE "slug" = 'super_admin';--> statement-breakpoint
UPDATE "auth_core_role" SET "permissions" = '{"tenant":["read","create","update"],"tier":["read","update"],"billing":["read","create"],"user":["read","impersonate"],"staff":["read","create","update","delete","ban"],"session":["read","revoke"],"role":["read","create","update","delete"],"authFeature":["read","configure"],"organization":["read","create","update","delete"],"apiKey":["read","create","update","revoke"],"oauthClient":["read","create","update","delete"],"sso":["read","configure","delete"],"auditLog":["read","export"]}'::jsonb, "updated_at" = now() WHERE "slug" = 'admin';--> statement-breakpoint
UPDATE "auth_core_role" SET "permissions" = '{"tenant":["read"],"tier":["read","update"],"billing":["read"],"user":["read"],"staff":["read","update","ban"],"session":["read","revoke"],"role":["read"],"authFeature":["read","configure"],"auditLog":["read","export"]}'::jsonb, "updated_at" = now() WHERE "slug" = 'security_admin';--> statement-breakpoint
UPDATE "auth_core_role" SET "permissions" = '{"tenant":["read","create","update"],"tier":["read","update"],"billing":["read"],"user":["read"],"staff":["read"],"session":["read"],"role":["read"],"auditLog":["read"]}'::jsonb, "updated_at" = now() WHERE "slug" = 'org_manager';--> statement-breakpoint
UPDATE "auth_core_role" SET "permissions" = '{"tenant":["read"],"user":["read","impersonate"],"session":["read","revoke"],"auditLog":["read"]}'::jsonb, "updated_at" = now() WHERE "slug" = 'support_agent';--> statement-breakpoint
UPDATE "auth_core_role" SET "permissions" = '{"tenant":["read"],"tier":["read"],"billing":["read"],"user":["read"],"staff":["read"],"session":["read"],"role":["read"],"authFeature":["read"],"auditLog":["read","export"]}'::jsonb, "updated_at" = now() WHERE "slug" = 'auditor';
