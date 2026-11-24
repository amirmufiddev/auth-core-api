# Design Document: Console Shell per Tenant

- **Tanggal:** 24 November 2026
- **Status:** Approved (brainstorm menu dan user journey)
- **Spec terkait:** [2026-11-24-auth-core-multitenant-design.md](./2026-11-24-auth-core-multitenant-design.md)
- **Kode yang disentuh:** `auth-core-console` (navigasi, route, halaman) dan `auth-core-api` (satu endpoint izin aktor)

Dokumen ini merapikan permukaan console setelah Auth Core menjadi multi-tenant. Keputusan 8 pada spec multi-tenant tetap berlaku: satu aplikasi console melayani operator, portal pelanggan, dan hosted auth. Yang berubah adalah cara operator dan pemilik tenant bernavigasi. Halaman hosted `/t/:slug/*` tidak berubah.

## 1. Masalah

Sidebar di `auth-core-console/src/config/menus.ts` masih satu pohon untuk semua akun: menu Application (Users, Roles, Organizations, Sessions, API Keys, Audit, Auth Features), menu operator, dan Tenant Portal. Kelola satu tenant hidup lagi sebagai tab di `/tenants/$tenantId`. Header memakai `OrganizationSwitcher`, tetapi labelnya "Switch Tenant / Workspace", sehingga platform, tenant, dan organisasi tercampur. Menu dan tombol tidak disaring menurut role.

Empat kategori akun tetap seperti yang sudah berjalan:

| Kategori | `user.tenant_id` | `user.role` | Console |
| --- | --- | --- | --- |
| Operator platform | `NULL` | slug platform, misalnya `super_admin` | Shell platform |
| Pemilik tenant | `NULL` | `user`, dan `tenant.owner_user_id` menunjuk akun ini | Shell tenant |
| End-user tenant | `ten_...` | `NULL` | Tidak masuk console. Login di `/t/:slug` |
| Member organisasi | `ten_...` | `NULL`, role ada di `member` | Tidak masuk console. Login di `/t/:slug` |

`user.role` adalah otorisasi platform. `member.role` adalah otorisasi organisasi di dalam tenant. Console ini tidak menampilkan menu berdasarkan `member.role`.

## 2. Keputusan yang dikunci

1. Dua shell di dalam satu aplikasi. Satu akun memakai satu shell sesuai role.
2. Operator bekerja di shell platform. Dari direktori tenant ia boleh membuka shell tenant yang sama dengan owner, dalam mode dukungan baca-saja, plus suspend, aktifkan, dan ganti tier.
3. Organizations, API Keys, OAuth, dan user tenant keluar dari sidebar platform. Mereka menjadi route shell tenant dan menggantikan tab.
4. Menu dan tombol platform mengikuti matriks `auth_core_role`. URL tanpa izin menampilkan keadaan tidak berwenang, tanpa data.
5. Dua pohon route: `/platform/...` dan `/tenants/:tenantId/...`.
6. Kunci izin API tidak diganti. `organization:read` membuka direktori tenant, billing ledger, dan mode dukungan. `organization:update` mencakup buat entri billing, suspend, aktifkan, dan ganti tier. `authConfig:configure` membuka Feature & Tier Matrix, termasuk pembacaannya, karena endpoint GET saat ini memakai izin itu.
7. Sesi hanya menyimpan slug role. Matriks dimuat dari `GET /api/admin/me/permissions`.
8. Mode dukungan tidak memakai query string. Layout menetapkannya dari role dan hasil API.

## 3. Shell dan route

Gerbang `_authenticated` hanya memastikan ada sesi. Dua layout anak merender sidebar.

### 3.1 Shell platform

| Route | Isi | Menu tampil bila |
| --- | --- | --- |
| `/platform` | Overview | Setiap akun yang masuk shell ini |
| `/platform/tenants` | Direktori tenant | `organization:read` |
| `/platform/tiers` | Feature & Tier Matrix | `authConfig:configure` |
| `/platform/billing` | Billing ledger | `organization:read` |
| `/platform/staff` | Staf platform, `tenant_id` kosong | `user:read` |
| `/platform/roles` | Role platform, `user.role` | `role:read` |
| `/platform/sessions` | Sesi staf | `session:read` |
| `/platform/audit` | Audit platform | `auditLog:read` |
| `/platform/auth-features` | Plugin layanan | `authConfig:read` atau `authConfig:configure` |
| `/platform/account` | Akun | Setiap akun yang masuk shell ini |

Tombol tulis pada halaman itu memakai aksi yang sama dengan API:

- Buat tenant: `organization:create`. Suspend, aktifkan, ganti tier: `organization:update`.
- Catat entri billing: `organization:update`.
- Simpan matriks dan ubah status fitur: `authConfig:configure`.
- Staf: `user:create`, `user:update`, `user:delete`, `user:ban`, `user:impersonate`.
- Role: `role:create`, `role:update`, `role:delete`.
- Cabut sesi: `session:revoke`.
- Ekspor audit: `auditLog:export`.
- Ubah plugin: `authConfig:configure`.

Label di matriks role platform diselaraskan dengan menu: Staf platform, Role platform, Sesi staf, Audit platform, Direktori tenant & billing, Plugin layanan & matriks tier. Kunci `organization` dan `authConfig` tetap.

Izin `apiKey`, `oauthClient`, dan `sso` tidak membuka item menu platform. Matriks di halaman Role Platform tidak menampilkan ketiga kelompok itu. Nilai yang sudah tersimpan di baris role diabaikan oleh menu dan tidak dihapus.

### 3.2 Shell tenant

`/tenants` adalah daftar tenant milik owner, plus aksi buat tenant. Halaman ini tidak memakai sidebar tenant.

| Route | Isi |
| --- | --- |
| `/tenants/:tenantId` | Ringkasan tenant |
| `/tenants/:tenantId/settings` | Pengaturan |
| `/tenants/:tenantId/features` | IAM Features |
| `/tenants/:tenantId/oauth-clients` | OAuth 2.1 / MCP |
| `/tenants/:tenantId/api-keys` | API Keys |
| `/tenants/:tenantId/users` | User tenant |
| `/tenants/:tenantId/organizations` | Organisasi di dalam tenant |
| `/tenants/:tenantId/billing` | Ringkasan billing |
| `/tenants/:tenantId/account` | Akun, komponen yang sama dengan akun platform |

Panel yang sekarang ada di `PortalTenantDetailPage` pindah menjadi halaman route. Form dan pemanggilan API-nya tetap. Tab dihapus.

Owner dari `tenant.owner_user_id` melihat seluruh menu tenant. Ia boleh mengubah pengaturan, fitur, OAuth, API key, user, dan organisasi, selama tier dan feature flag mengizinkan. Ringkasan billing di shell tenant tetap baca-saja. Perubahan ledger hanya ada di `/platform/billing`. Bila fitur terkunci, menu tetap ada, halaman menampilkan `FeatureDisabledCard`, dan tombol tulis nonaktif.

### 3.3 Perjalanan login

Login console tetap `/login`.

- Akun platform menuju `/platform`.
- Owner dengan tepat satu tenant menuju `/tenants/:tenantId`.
- Owner dengan lebih dari satu tenant menuju `/tenants`.
- Role `user` yang belum punya tenant menuju `/tenants` dalam keadaan kosong, dengan aksi buat tenant.
- End-user dan member organisasi tetap lewat `/t/:slug/login`.

Akun masuk shell platform bila `tenant_id` kosong dan, setelah `user.role` dipecah pada koma seperti `PlatformPermissionGuard`, ada minimal satu slug yang bukan `user`. Selain itu, termasuk slug kosong, `NULL`, atau hanya `user`, akun masuk alur pemilik tenant. Bila ia tidak memiliki tenant, tujuannya `/tenants` dalam keadaan kosong.

Owner yang membuka `/platform` diarahkan ke rumah login-nya. Operator yang membuka `/tenants` diarahkan ke `/platform/tenants`.

### 3.4 Mode dukungan

Operator dengan `organization:read` membuka URL shell tenant yang sama. Aktor platform tidak pernah mendapat mode tulis di shell tenant, termasuk bila `owner_user_id` kebetulan menunjuk akunnya.

- Tenant tidak ditemukan: keadaan tidak ditemukan, tanpa data dan tanpa mode dukungan.
- Aktor platform dengan `organization:read`: mode dukungan. Data dibaca lewat API operator. Tombol tulis tenant disembunyikan, termasuk impersonate pada user tenant. Suspend, aktifkan, dan ganti tier tampil di ringkasan bila ada `organization:update`. Banner menautkan kembali ke `/platform/tenants`.
- Bukan aktor platform, dan API portal mengakui ia owner: mode tulis.
- Selain itu: halaman tidak berwenang, tanpa data tenant.

Impersonate tetap hanya di `/platform/staff`, dan hanya bila ada `user:impersonate`.

### 3.5 Header

Shell platform tidak menampilkan switcher organisasi. Pencarian menu memakai katalog shell yang sudah disaring izin.

Shell tenant milik owner menampilkan switcher tenant dari daftar tenant miliknya. Mode dukungan menampilkan nama tenant yang sedang dibuka, tanpa switcher itu. Switcher organisasi hanya hidup di dalam halaman Organizations tenant.

### 3.6 Path lama

Redirect memilih tujuan dari shell akun yang sedang login. Rumah owner adalah shell tenant tunggalnya, atau `/tenants` bila tenant-nya bukan tepat satu.

| Path lama | Akun platform | Owner |
| --- | --- | --- |
| `/dashboard` | `/platform` | Rumah owner |
| `/users` | `/platform/staff` | `/tenants/:id/users` bila tepat satu tenant, selain itu rumah owner |
| `/roles` | `/platform/roles` | Rumah owner |
| `/sessions` | `/platform/sessions` | Rumah owner |
| `/audit-logs` | `/platform/audit` | Rumah owner |
| `/auth-features` | `/platform/auth-features` | Rumah owner |
| `/api-keys` | `/platform` | `/tenants/:id/api-keys` bila tepat satu tenant, selain itu rumah owner |
| `/organizations` | `/platform` | `/tenants/:id/organizations` bila tepat satu tenant, selain itu rumah owner |
| `/admin-tenants` | `/platform/tenants` | Rumah owner |
| `/admin-tiers` | `/platform/tiers` | Rumah owner |
| `/admin-billing` | `/platform/billing` | Rumah owner |
| `/account` | `/platform/account` | `/tenants/:id/account` bila tepat satu tenant, selain itu `/tenants` |
| `/tenants/:id` bentuk tab | Shell tenant mode dukungan bila ada `organization:read`, selain itu tidak berwenang | Ringkasan tenant bila ia owner, selain itu tidak berwenang |

## 4. Izin aktor

`GET /api/admin/me/permissions` mengembalikan daftar `{ slug, permissions }` untuk setiap slug pada `user.role` sesi. Akun platform mana pun boleh memanggilnya, tanpa `role:read`. Akun dengan `tenant_id` ditolak. Tanpa sesi mengembalikan 401. Slug yang tidak punya baris di `auth_core_role` tidak menyumbang izin.

Console menyimpan hasil itu di cache query. Pemeriksaan menu memakai aturan yang sama dengan `PlatformPermissionGuard`: salah satu role mengizinkan bila aksi ada pada resource, resource memuat `*`, atau resource `*` memuat aksi itu atau `*`. `listRoles` tidak dipakai untuk menyaring menu, karena endpoint itu membutuhkan `role:read`.

Guard API tetap penentu akses. Menyembunyikan menu dan tombol tidak menggantikan guard. Respons 403 yang lolos dari UI tampil sebagai toast.

## 5. Komponen

- `resolveConsoleHome`, `filterNav`, `resolveTenantMode`, dan peta redirect adalah fungsi murni di console, terpisah dari komponen layout.
- `menus.ts` menjadi dua katalog: platform, dan tenant yang menerima `tenantId`. Tiap item platform yang berizin membawa resource dan aksi baca.
- `PlatformShell` dan `TenantShell` merender sidebar dari katalog yang sudah disaring. Halaman yang sudah ada ikut pindah route. `AppSidebar` dan `Header` berhenti membaca satu `menusConfig` global.
- `OrganizationSwitcher` keluar dari `Header`. Switcher tenant adalah komponen header shell tenant.
- Keadaan tidak berwenang adalah satu komponen di dalam shell: judul, tanpa data, tautan ke beranda shell.
- Aksi yang sudah ada di halaman Organizations tenant mengikuti mode owner atau dukungan. Desain ini tidak menambah editor role organisasi.

## 6. Pengujian

`auth-core-console` memakai `bun run test:routes` (`scripts/routes.test.mjs`). Skrip itu diperbarui agar mengunci katalog baru, bukan href lama. Kasus fungsi murni:

- Rumah login untuk role platform, owner satu tenant, owner banyak tenant, dan owner tanpa tenant.
- Menu platform tampil hanya bila izin bacanya terpenuhi. Overview dan Akun selalu ada. `apiKey`, `oauthClient`, dan `sso` tidak menambah item.
- Mode tenant: owner, dukungan bila aktor platform punya `organization:read` (termasuk `*`), ditolak untuk akun lain, dan tidak ditemukan bila tenant tidak ada. Aktor platform tidak masuk mode tulis.
- Peta path lama pada tabel di bagian 3.6.

API memakai `bun test` untuk `GET /api/admin/me/permissions`: akun platform mendapat matriksnya tanpa `role:read`, akun bertenant ditolak, tanpa sesi 401, slug tanpa baris role menghasilkan matriks kosong. Guard platform yang sudah ada tetap lulus.

Setelah keduanya lulus, empat perjalanan dicek di browser pada aplikasi yang sedang berjalan:

- `super_admin` masuk shell platform, tanpa switcher organisasi, tanpa menu Organizations, API Keys, atau OAuth global.
- `support_agent` hanya melihat menu yang izinnya ia punya, membuka tenant dalam mode dukungan, dan tidak melihat tombol tulis maupun suspend.
- `super_admin` dalam mode dukungan melihat suspend, aktifkan, dan ganti tier, serta tidak melihat tombol tulis tenant.
- Owner satu tenant mendarat di shell tenant. Owner yang membuka `/platform` kembali ke rumahnya. Fitur yang terkunci tier menampilkan `FeatureDisabledCard`. Bookmark `/users` mengikuti tabel redirect.

## 7. Di luar cakupan

- Perubahan halaman hosted `/t/:slug/*`.
- Editor `member.role` atau `organization_role` yang belum ada.
- Penggantian nama kunci izin di API, termasuk memisahkan billing dari `organization:*`.
- Penghapusan data izin `apiKey`, `oauthClient`, dan `sso` yang sudah tersimpan.
- Memecah console menjadi dua aplikasi.

Satu implementation plan cukup untuk pekerjaan ini. Urutan di dalam plan: endpoint izin, fungsi murni dan katalog menu, pemindahan route, penyaringan tombol, lalu pemeriksaan browser.
