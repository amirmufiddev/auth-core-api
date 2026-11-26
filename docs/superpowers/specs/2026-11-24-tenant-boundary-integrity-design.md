# Design Document: Integritas Batas Tenant

- **Tanggal:** 24 November 2026
- **Status:** Approved
- **Spec acuan:** [2026-11-24-auth-core-multitenant-design.md](./2026-11-24-auth-core-multitenant-design.md)

Dokumen ini mengunci empat penguatan di atas model yang sudah ada: `user.tenant_id NULL` = akun platform, `NOT NULL` = user pool tenant. `organization` tetap workspace di dalam satu tenant.

---

## 1. Keputusan yang dikunci

1. Kunci cache tenant dan kunci cache organization memakai accessor dan prefix yang berbeda.
2. Otorisasi platform membaca `user.tenant_id` dari baris database dan menolak user tenant sebelum membaca `user.role`. Plugin Better Auth `admin()` menolak aktor yang konteks request-nya tidak sama dengan `user.tenant_id`. Role `admin` di dalam user pool tenant tetap sah.
3. Kecocokan `tenant_id` anak dengan induk ditegakkan oleh kolom generated `tenant_scope` plus composite foreign key. `NULL` pada `tenant_id` tetap berarti platform.
4. Tenant tidak di-hard-delete. Setiap FK operasional ke `tenant.id` memakai `ON DELETE RESTRICT`. `audit_trail_logs.tenant_id` tetap `ON DELETE SET NULL`. Satu-satunya penonaktifan produk adalah `tenant.status = 'suspended'`.

---

## 2. Cache dan `RlsContext`

### 2.1 Bentuk context

`RlsContext.run` hanya menerima objek:

```ts
interface RlsStore {
  tenantId: string | null;
  organizationId: string | null;
}

hasStore(): boolean
getCurrentTenantId(): string | null
getCurrentOrganizationId(): string | null
```

`getCurrentTenantId()` mengembalikan `null` bila tidak ada store dan bila request platform (`tenantId: null`). `hasStore()` membedakan keduanya. Overload `RlsContext.run(organizationId: string)` dihapus, termasuk pemakaiannya di tes dan dokumen di `src/shared/README.md`, `docs/database.md`, `docs/testing.md`, `docs/auth.md`, `docs/security-guidelines.md`, dan `docs/anti-patterns-reference.md`.

`RlsInterceptor` sudah mengisi `{ tenantId, organizationId }`. Perilaku interceptor tidak berubah.

### 2.2 Kunci cache

`CacheService.buildKey` dan `CacheService.setScoped` dihapus. Kegagalan scope melempar `CacheScopeMissingError`, subclass `Error`.

| Method | Sumber scope | Bentuk kunci |
| --- | --- | --- |
| `buildTenantKey(key, globalPrefix)` | `getCurrentTenantId()` | ada tenant: `${prefix}:tenant:${tenantId}:${key}` |
| `buildTenantKey` | store ada, `tenantId === null` | `${prefix}:platform:${key}` |
| `buildTenantKey` | `hasStore() === false` | lempar `CacheScopeMissingError` |
| `buildOrganizationKey(key, globalPrefix)` | `getCurrentOrganizationId()` non-null | `${prefix}:org:${organizationId}:${key}` |
| `buildOrganizationKey` | store tidak ada atau `organizationId === null` | lempar `CacheScopeMissingError` |
| `setTenantScoped(tenantId: string \| null, ...)` | argumen eksplisit, untuk job | prefix `tenant:` atau `platform:` |
| `setOrganizationScoped(organizationId: string, ...)` | argumen eksplisit | prefix `org:` |

`PermissionScopeCacheService` tetap memakai kunci org-nya sendiri. Primary key `organization.id` unik secara global, jadi kunci itu tidak dicampur dengan prefix baru.

Invalidasi tenant hanya menyentuh prefix `tenant:` atau `platform:`. Invalidasi organization hanya menyentuh prefix `org:`.

---

## 3. Guard akun platform

### 3.1 Helper

Satu fungsi di modul RBAC, dipakai `PlatformPermissionGuard` dan `TenantOwnerGuard`:

```ts
assertPlatformAccount(db, userId: string): Promise<{ id: string; role: string | null; tenantId: null }>
```

Fungsi ini memuat baris `user` by primary key. User yang tidak ada, atau `tenant_id` yang terisi, menghasilkan `403` dengan pesan yang sudah dipakai guard masing-masing. Session tanpa `user.id` tetap `401`.

Jika payload sesi sudah membawa `tenantId` string non-kosong, guard menolak `403` tanpa query. Payload `tenantId === null` atau `undefined` tetap wajib lewat `assertPlatformAccount`.

Slug role dan matriks permission dibaca dari `user.role` di database, bukan dari klaim sesi.

### 3.2 Plugin `admin()`

Di `buildTenantIsolationPlugin`, middleware `before` pada path yang diawali `/admin`:

1. Muat `user.tenant_id` aktor dari database.
2. Bandingkan dengan `getEffectiveTenantContext().tenantId`.
3. Keduanya `null`, atau keduanya string yang sama: lanjut. Plugin tetap yang memeriksa `user.role`.
4. Selain itu: `403` kode `CROSS_TENANT_ADMIN`.

User tenant dengan `role = admin` tetap boleh memanggil admin API instance tenant-nya sendiri. User itu ditolak di instance platform. User platform ditolak di admin API tenant.

### 3.3 Audit

Di `auth-config.controller.ts`, fallback `session.user.role ?? 'admin'` menjadi `session.user.role ?? 'user'`. Nilai ini hanya label audit. Otorisasi endpoint itu tetap di `@RequirePlatformPermission`.

Tidak ada `CHECK` yang melarang `user.role = 'admin'` pada user tenant.

---

## 4. `tenant_scope` dan composite foreign key

### 4.1 Kolom

Pada setiap tabel yang punya `tenant_id`:

```sql
tenant_scope text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL
CHECK (tenant_id IS NULL OR tenant_id <> '')
```

`tenant.id` mendapat `CHECK (id <> '')`. String kosong tidak pernah menjadi id tenant. Sentinel `''` hanya hidup di kolom generated dan mewakili platform. Aplikasi dan `additionalFields` Better Auth tidak menulis `tenant_scope`. PostgreSQL yang menghitungnya.

Drizzle 0.45: `text('tenant_scope').generatedAlwaysAs(sql\`coalesce(tenant_id, '')\`, { mode: 'stored' }).notNull()`. Constraint dideklarasikan di schema TypeScript. File SQL hasil `drizzle-kit generate` tidak diedit manual.

Unique yang menjadi target FK:

- `user (id, tenant_scope)` dengan nama `uq_user_id_tenant_scope`
- `organization (id, tenant_scope)` dengan nama `uq_organization_id_tenant_scope`

### 4.2 Kecocokan dengan user

Composite FK `(user_id, tenant_scope) → user (id, tenant_scope)` `ON DELETE CASCADE`, `MATCH SIMPLE`, pada:

- `session`, `account`, `member`, `passkey`, `two_factor`, `oauth_refresh_token` (`user_id` sudah `NOT NULL`)
- `oauth_access_token`, `oauth_consent`, `device_code`, `sso_provider` (`user_id` nullable)

`MATCH SIMPLE` melewatkan pemeriksaan hanya bila `user_id` NULL. Karena `tenant_scope` tidak pernah NULL, baris yang `user_id`-nya terisi wajib cocok, termasuk pasangan platform (`tenant_id` NULL di kedua sisi, `tenant_scope = ''`).

FK `user_id → user.id` yang sudah `ON DELETE CASCADE` tetap ada. Menghapus satu user tetap membersihkan credential-nya.

### 4.3 Kecocokan dengan organization

Composite FK ke `organization (id, tenant_scope)` `ON DELETE CASCADE`:

| Tabel | Kolom |
| --- | --- |
| `member` | `(organization_id, tenant_scope)` |
| `invitation` | `(organization_id, tenant_scope)` |
| `organization_role` | `(organization_id, tenant_scope)` |
| `session` | `(active_organization_id, tenant_scope)` |

`session.active_organization_id` boleh NULL. `MATCH SIMPLE` melewatkan baris itu. `invitation.inviter_id` tidak ikut composite FK ke `user`: Operator Console membuat undangan dengan `inviter_id` akun platform dan `tenant_id` organization tenant. `invitation` hanya wajib satu tenant dengan organization-nya.

Akibatnya, session platform (`tenant_scope = ''`) tidak dapat menunjuk organization tenant, karena `organization.tenant_id` `NOT NULL`. Ini selaras dengan hook `organization/set-active` yang sudah menolak organization di luar tenant request.

`member.tenant_id` mengikuti organization dan user sekaligus. Hook `beforeAcceptInvitation` sudah mewajibkan `user.tenantId === org.tenantId`. User platform bukan member organization tenant.

### 4.4 Penolakan di adapter

`wrapTenantScopedAdapter` pada `create` dan `update` menolak sebelum query bila:

- model §4.2 punya `userId` terisi, lalu user itu tidak ada atau `user.tenant_id IS DISTINCT FROM` `tenant_id` baris: `403` `CROSS_TENANT_USER_SCOPE`
- model §4.3 punya `organizationId` atau `activeOrganizationId` terisi, lalu organization itu tidak ada atau `organization.tenant_id IS DISTINCT FROM` `tenant_id` baris: `403` `CROSS_TENANT_ORGANIZATION`

`inviterId` tidak diperiksa sebagai `userId`. Lookup induk memanggil method adapter mentah, tanpa filter tenant. User atau organization yang tidak ketemu tetap ditolak, supaya lookup yang ter-filter tidak lolos lalu baru jatuh ke FK. Hook `session.create.before` yang sudah membandingkan owner dengan konteks request tetap dipertahankan.

Composite FK adalah backstop untuk tulisan yang melewati adapter. Migrasi tidak memperbaiki data yang menyimpang. Jika ada baris lama yang melanggar, `drizzle-kit migrate` gagal pada FK itu.

---

## 5. Suspend, bukan hard delete

Setiap FK yang menargetkan `tenant.id` dan saat ini `ON DELETE CASCADE` berubah menjadi `ON DELETE RESTRICT`. Yang sudah `ON DELETE SET NULL` pada `audit_trail_logs.tenant_id` tidak berubah.

`TenantService` tetap menonaktifkan tenant lewat `status: 'suspended'`. Spec ini tidak menambah endpoint purge.

`DELETE FROM tenant` gagal selama masih ada baris operasional yang mereferensikannya, termasuk user tenant, organization, session, billing, dan config fitur. Menghapus satu user tetap diizinkan dan tetap cascade ke anak user tersebut.

Mengubah `user.tenant_id` sementara anak masih mereferensikan `tenant_scope` lama gagal di FK. Pemindahan user antar tenant berada di luar spec ini.

---

## 6. Tes

- `cache.service.spec.ts`: kunci `tenant:`, `platform:`, dan `org:` terpisah; tanpa store dan tanpa organization melempar `CacheScopeMissingError`; `setTenantScoped(null, ...)` menulis prefix `platform:`.
- `rls-context.spec.ts`: `run` hanya objek; `hasStore()` false di luar `run` dan true di dalam `run` platform (`tenantId: null`).
- `platform-permission.guard.spec.ts` dan tes `TenantOwnerGuard`: sesi mengklaim `tenantId: null` dan `role: 'admin'`, baris DB `tenant_id` terisi, hasilnya `403` dan matriks role tidak dibaca.
- Tes adapter: create `account` atau `member` yang `user.tenant_id`-nya berbeda dari `tenant_id` baris melempar `CROSS_TENANT_USER_SCOPE`.
- Tes middleware `/admin`: aktor tenant pada konteks platform, dan aktor platform pada konteks tenant, sama-sama `403` `CROSS_TENANT_ADMIN`. Aktor tenant pada konteks tenant yang sama lolos middleware ini.
- Tes integrasi PostgreSQL dalam transaksi yang di-rollback: session platform (`tenant_id` NULL) untuk user platform lolos; session dengan `tenant_id` berbeda dari `user.tenant_id` gagal; `DELETE` tenant yang masih punya user gagal; update `status = 'suspended'` lolos.

---

## 7. Di luar scope

- Check constraint yang melarang role admin pada user tenant.
- Purge atau soft-delete timestamp pada `tenant`.
- Mengganti kunci internal `PermissionScopeCacheService`.
- Policy PostgreSQL `ENABLE ROW LEVEL SECURITY`.
- Memindahkan user dari satu tenant ke tenant lain.
