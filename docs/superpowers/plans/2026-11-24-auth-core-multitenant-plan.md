# Auth Core Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah Auth Core dari layanan Better Auth single-instance menjadi platform IAM multi-tenant terisolasi penuh (Fase 0–5) lengkap dengan 4-tier feature management terenkripsi, Portal Pelanggan, Operator Console, dan Hosted Tenant Auth Pages.

**Architecture:** Satu deployment NestJS 11 + Fastify 5 dengan dua tahap resolusi tenant sebelum controller/handler: `FastifyAdapter({ rewriteUrl })` (sinkron sebelum routing `find-my-way` untuk melepas `/t/<slug>` pada `/t/<slug>/api/*`) dan callback `registerTenantResolverHook` (`onRequest` hook non-`async` yang mengikat `TenantContextStorage` ALS) untuk mengarahkan request ke `AuthRuntimeRegistry` (1 instance Platform + LRU cache Better Auth per `${tenantId}:${source}:${configVersion}:${catalogVersion}` berbagi satu PG pool & Redis client) dan modul bisnis SOLID (`tenant`, `feature-tier`, `billing`, `customer-portal`, `tenant-context`, `platform-console`). Frontend `auth-core-console` menyajikan 3 permukaan dalam satu aplikasi TanStack Router.

**Tech Stack:** TypeScript, NestJS 11, Fastify 5, Drizzle ORM, PostgreSQL, Redis (`ioredis`), Better Auth `^1.7.27`, `better-auth-multi-tenant`, Argon2, Node `node:crypto` (AES-256-GCM), Bun test runner, React 19, Vite, TanStack Router/Table/Query, Zod, Zustand.

**Spec:** [2026-11-24-auth-core-multitenant-design.md](../specs/2026-11-24-auth-core-multitenant-design.md)

## Progress (ledger: `auth-core-api/.superpowers/sdd/progress.md`)

| Status | Detail |
|--------|--------|
| **Task 1–20** | Selesai (branch `feat/multitenant-iam`) |
| **E2E** | `test/multitenant-acceptance.e2e-spec.ts` — 6/6 pass |
| **Verifikasi terakhir (2026-11-24)** | API: `bun test` 669 pass, lint, build OK · Console: typecheck, lint (0 errors), `test:routes`, build OK |
| **Checkbox step di bawah** | Belum disinkronkan per-step; gunakan ledger + git sebagai sumber kebenaran |

## Global Constraints

- Arsitektur SOLID per modul (`controllers/`, `services/`, `repositories/`, `interfaces/`, `dto/`, `index.ts`): maksimal 300 baris per service, DIP melalui repository interface + injection token, pagination/filtering wajib di DB (`LIMIT`/`OFFSET` + `WHERE` SQL), dilarang cross-module import ke subfolder internal.
- Resolusi tenant wajib memakai kombinasi `FastifyAdapter({ rewriteUrl })` (melepas `/t/<slug>` secara generik untuk seluruh `/t/<slug>/api/*` termasuk `/api/social-bridge/*` dan menormalisasi `req.raw.url` sebelum routing Fastify 5) + callback-style `fastify.addHook('onRequest', (req, reply, done) => ...)` yang membungkus `TenantContextStorage.run(ctx, () => done())` (bukan NestJS `middie` middleware dan bukan hook `async`), agar `AsyncLocalStorage` dan Web `Request` Better Auth tetap konsisten; di mode path `/t/:slug`, wajib set `cookiePrefix: ac_t_<slug>` dan `Path=/t/<slug>` (Platform: `ac_platform`, `Path=/`).
- `AuthRuntimeRegistry` (LRU max 200) keyed by **`${tenantId}:${source}:${configVersion}:${catalogVersion}`** (`source: 'subdomain' | 'path'`, `catalogVersion` global di Redis di-`INCR` O(1)) dan wajib berbagi satu `getSharedPool()` PostgreSQL + satu `BETTER_AUTH_REDIS_CLIENT` Redis tanpa membuat koneksi baru per tenant.
- Partial unique indexes pada tabel `user` (`WHERE tenant_id IS NULL` dan `WHERE tenant_id IS NOT NULL`) wajib dideklarasikan langsung di Drizzle TypeScript schema memakai `uniqueIndex(...).on(...).where(sql\`...\`)` agar tidak terjadi snapshot drift.
- Base path Better Auth distandardisasi ke `/api/auth` (`BETTER_AUTH_PATH=/api/auth` di API, `VITE_AUTH_BASE_PATH=/api/auth` di Console).
- Enkripsi secret fitur menggunakan AES-256-GCM dengan `AUTH_CONFIG_ENCRYPTION_KEY` (dan fallback dekripsi `AUTH_CONFIG_ENCRYPTION_KEY_PREV` untuk rotasi _zero-downtime_); penulisan secret tanpa kunci aktif ditolak, input secret kosong tidak menimpa ciphertext lama, response API hanya mengembalikan `secretsConfigured`, dan secret tenant tidak pernah jatuh ke env platform.
- WebAuthn Passkey `rpID` tenant dikunci default ke `TENANT_BASE_DOMAIN` (atau `localhost` saat dev) agar kredensial di `/t/:slug` tetap valid setelah pindah ke subdomain.
- Central Social OAuth Callback Bridge tidak boleh menerbitkan cookie sesi langsung dari host pusat; `returnOrigin` wajib dibentuk murni di sisi server dan `returnTo` divalidasi hanya menerima _relative path_ aman (`/^\//` dan bukan `//`, anti Open Redirect); endpoint exchange ditempatkan di `/api/social-bridge/exchange` (di luar wildcard `/api/auth/*` Better Auth; pada mode path: `/t/${tenantSlug}/api/social-bridge/exchange`), one-time exchange code disimpan di Redis (`GETDEL`, TTL 45s), cookie _host-only_ diterbitkan oleh host tenant sendiri, dan auto-link ditolak jika `emailVerified === false`.
- Isolasi OAuth 2.1 penuh: `oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent` memiliki `tenant_id`, dan endpoint `authorize`/`token`/`consent`/`introspect`/`revoke` memblokir `oauth_client.tenantId !== tenantContext.tenantId`; child tables (`account`, `passkey`, `two_factor`, `member`, `invitation`, `organization_role`) ikut membawa `tenant_id` untuk kesiapan native RLS.
- JWT Access Token TTL dikunci pendek (5–15 menit, max 900s); aksi finansial/sensitif POS wajib memverifikasi real-time ke `GET /api/context/session`.
- Downgrade tier & disable fitur bersifat fail-closed non-destruktif; desain lama `plan: 'Pro'` pada `organization.metadata` dihapus total; `tenant.slug` immutable setelah dibuat; 15 reserved slugs (`auth`, `console`, `api`, `admin`, `www`, `t`, `app`, `docs`, `mail`, `status`, `oauth`, `sso`, `scim`, `billing`, `static`) ditolak `400`; request ke tenant `suspended` ditolak `403 TENANT_SUSPENDED`.
- Verifikasi akhir wajib lulus: di `auth-core-api` (`bun test`, `bun run lint`, `bun run build`) dan di `auth-core-console` (`bun run typecheck`, `bun run lint`, `bun run test:routes`, `bun run build`).

## Review Focus

1. **Cross-tenant session replay, `activeOrganizationId` spoofing, OAuth client silang tenant, & concurrent ALS isolation:** Session tenant A ke host/path tenant B, `setActiveOrganization` ke org tenant B, atau `authorize`/`token` memakai `client_id` milik tenant B di host tenant A harus ditolak `403`; concurrent request paralel 2 tenant di Fastify tidak boleh mencampur `TenantContextStorage` maupun mengembalikan `404` pada `/t/:slug/api/*` (di-pin di Task 9 & Task 12).
2. **Tenant secret isolation, key rotation (`_PREV`), mode path/social cookie isolation & anti-open-redirect:** Tenant tanpa secret Google tidak mewarisi env platform; tulis secret tanpa encryption key ditolak; dekripsi ciphertext lama tetap sukses saat rotasi dengan `AUTH_CONFIG_ENCRYPTION_KEY_PREV`; login `/t/amir` tidak menimpa cookie `/t/bima` maupun Platform; akses tenant yang sama via `path` vs `subdomain` tidak salah pakai instance LRU; social exchange menolak `returnOrigin` eksternal & auto-link email tak terverifikasi (di-pin di Task 2, Task 9, Task 10, Task 16, & Task 18).
3. **Fail-closed non-destruktif saat downgrade tier atau disable fitur:** Tenant dengan fitur `twoFactor`/`socialGoogle` aktif yang di-downgrade ke `Free` atau fiturnya di-disable Operator langsung kehilangan fitur tersebut di runtime (`catalogVersion` O(1)), namun kembali utuh saat di-upgrade lagi (di-pin di Task 16).
4. **Uniqueness lintas tenant vs dalam satu tenant:** Email/username/phone yang sama di `tenant A` dan `tenant B` berhasil dibuat sebagai 2 user berbeda, sedangkan duplikasi di tenant yang sama atau sesama akun platform ditolak `409` (di-pin di Task 3 & Task 9).
5. **Tenant `suspended`, immutable slug, & reserved slug bypass:** Request auth/context ke tenant `suspended` ditolak `403 TENANT_SUSPENDED`; pembuatan tenant dengan 15 reserved slugs atau update `tenant.slug` ditolak `400` (di-pin di Task 6 & Task 9).

---

## Fase 0: Hardening, Path Alignment, Schema Baseline & SOLID Split Awal

### Task 1: Standardisasi Env, Base Path `/api/auth` & Cleanup Seed Scripts

**Files:**

- Modify: `auth-core-api/src/config/env.validation.ts:19-112`
- Modify: `auth-core-api/.env.example:21-27`
- Modify: `auth-core-api/.env:21-27`
- Modify: `auth-core-api/package.json:25-31`
- Modify: `auth-core-console/.env.example:1-6`
- Modify: `auth-core-console/.env`
- Test: `auth-core-api/src/config/env.validation.spec.ts`

**Interfaces:**

- Produces (`EnvConfig` additions in `auth-core-api/src/config/env.validation.ts`):
  - `BETTER_AUTH_PATH`: default `'/api/auth'`
  - `AUTH_CONFIG_ENCRYPTION_KEY`: `string` (optional at boot, default `''`)
  - `AUTH_CONFIG_ENCRYPTION_KEY_PREV`: `string` (optional at boot, default `''`)
  - `TENANT_BASE_DOMAIN`: `string` (default `'authcore.local'`)
  - `PLATFORM_HOSTS`: `string` (default `'localhost,127.0.0.1,auth.authcore.local,console.authcore.local'`)
  - `SOCIAL_CALLBACK_BASE_URL`: `string` (optional, default `''`)
  - `AUTH_RUNTIME_LRU_MAX`: `number` (default `200`)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'bun:test';
import { validate } from './env.validation';

describe('envSchema multi-tenant defaults', () => {
  it('defaults BETTER_AUTH_PATH to /api/auth and exposes multi-tenant env keys', () => {
    const parsed = validate({
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/authcore',
      BETTER_AUTH_URL: 'http://localhost:2001',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      BETTER_AUTH_CLIENT_URL: 'http://localhost:2000',
    });
    expect(parsed.BETTER_AUTH_PATH).toBe('/api/auth');
    expect(parsed.TENANT_BASE_DOMAIN).toBe('authcore.local');
    expect(parsed.AUTH_CONFIG_ENCRYPTION_KEY).toBe('');
    expect(parsed.AUTH_CONFIG_ENCRYPTION_KEY_PREV).toBe('');
    expect(parsed.AUTH_RUNTIME_LRU_MAX).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/config/env.validation.spec.ts`
Expected: FAIL because `BETTER_AUTH_PATH` defaults to `/v1/auth` and new env fields are missing.

- [ ] **Step 3: Implement env schema updates and cleanup package.json**

Perbarui `envSchema` di `auth-core-api/src/config/env.validation.ts` dengan default `BETTER_AUTH_PATH: '/api/auth'` serta field `AUTH_CONFIG_ENCRYPTION_KEY`, `AUTH_CONFIG_ENCRYPTION_KEY_PREV`, `TENANT_BASE_DOMAIN`, `PLATFORM_HOSTS`, `SOCIAL_CALLBACK_BASE_URL`, `AUTH_RUNTIME_LRU_MAX`. Samakan `.env`, `.env.example` di API & Console ke `/api/auth`, dan hapus script usang `db:seed:org-members` & `db:seed:org-invitations` dari `auth-core-api/package.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-core-api && bun test src/config/env.validation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/config/env.validation.ts auth-core-api/src/config/env.validation.spec.ts auth-core-api/.env.example auth-core-api/package.json auth-core-console/.env.example
git commit -m "chore: align better-auth base path to /api/auth and add multitenant env config"
```

---

### Task 2: `CryptoService` (AES-256-GCM Secret Encryption & Zero-Downtime Key Rotation)

**Files:**

- Create: `auth-core-api/src/common/crypto/crypto.service.ts`
- Create: `auth-core-api/src/common/crypto/crypto.module.ts`
- Create: `auth-core-api/src/common/crypto/index.ts`
- Modify: `auth-core-api/src/app.module.ts`
- Test: `auth-core-api/src/common/crypto/crypto.service.spec.ts`

**Interfaces:**

- Consumes: `ConfigService` (`AUTH_CONFIG_ENCRYPTION_KEY`, `AUTH_CONFIG_ENCRYPTION_KEY_PREV`)
- Produces (`src/common/crypto/crypto.service.ts`):

  ```typescript
  export interface EncryptedPayload {
    v: 1;
    kid?: string;
    alg: 'aes-256-gcm';
    iv: string;
    tag: string;
    ct: string;
  }
  export class CryptoService {
    hasEncryptionKey(): boolean;
    encryptSecret(plaintext: string): EncryptedPayload;
    decryptSecret(payload: EncryptedPayload): string;
    mergeSecrets(
      existing: Record<string, EncryptedPayload>,
      incoming: Record<string, string | null | undefined>,
      clearKeys?: string[],
    ): Record<string, EncryptedPayload>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Tambahkan test di `crypto.service.spec.ts` **(Review Focus #2)**:

- `encryptSecret` + `decryptSecret` round-trip menghasilkan plaintext asli dengan `kid` & IV unik per pemanggilan.
- `decryptSecret` berhasil mendekripsi ciphertext yang dienkripsi memakai kunci lama ketika kunci dirotasi (`AUTH_CONFIG_ENCRYPTION_KEY` baru + `AUTH_CONFIG_ENCRYPTION_KEY_PREV` lama).
- `encryptSecret` dan `mergeSecrets` dengan incoming non-empty melempar `BusinessError` (`ENCRYPTION_KEY_MISSING`) saat `AUTH_CONFIG_ENCRYPTION_KEY` kosong atau panjang byte != 32.
- `mergeSecrets` dengan nilai `""` / `undefined` mempertahankan ciphertext lama, sedangkan key pada `clearKeys` dihapus.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/common/crypto/crypto.service.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `CryptoService` & `@Global() CryptoModule`**

Implementasikan `CryptoService` memakai `node:crypto` (`aes-256-gcm`, 12-byte random IV, 16-byte auth tag) menerima 64-char hex atau base64 32-byte key untuk `AUTH_CONFIG_ENCRYPTION_KEY` dan `AUTH_CONFIG_ENCRYPTION_KEY_PREV` (fallback saat dekripsi). Export `CryptoModule` dan daftarkan di `AppModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd auth-core-api && bun test src/common/crypto/crypto.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/common/crypto auth-core-api/src/app.module.ts
git commit -m "feat(crypto): add AES-256-GCM CryptoService with previous-key fallback rotation"
```

---

### Task 3: Drizzle Schema Multi-Tenant Target (Partial Unique Indexes di TS Schema) + Baseline Migration + `auth-tiers` Seed

**Files:**

- Create: `auth-core-api/src/database/schema/auth-tier.ts`
- Create: `auth-core-api/src/database/schema/auth-feature.ts`
- Create: `auth-core-api/src/database/schema/tenant.ts`
- Create: `auth-core-api/src/database/schema/tenant-billing.ts`
- Create: `auth-core-api/src/database/schema/tenant-auth-feature-config.ts`
- Create: `auth-core-api/src/database/seeds/auth-tiers.seed.ts`
- Modify: `auth-core-api/src/database/schema/auth-feature-config.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-user.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-session.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-account.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-passkey.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-two-factor.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-organization.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-member.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-invitation.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-oauth-provider.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-verification.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-api-key.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-device-code.ts`
- Modify: `auth-core-api/src/database/schema/better-auth-sso.ts`
- Modify: `auth-core-api/src/database/schema/audit-trail.ts`
- Modify: `auth-core-api/src/database/schema/index.ts`
- Modify: `auth-core-api/src/database/seed.ts`
- Test: `auth-core-api/src/database/schema/multitenant-schema.spec.ts`
- Test: `auth-core-api/src/database/seeds/auth-tiers.seed.spec.ts`

**Interfaces:**

- Produces exported Drizzle tables & inferred types: `authTiers`, `authFeatures`, `authTierFeatures`, `tenant`, `tenantBillingRecords`, `tenantAuthFeatureConfig`, `authFeatureConfig` (updated), serta kolom `tenantId` pada `user`, `session`, `organization`, `organizationRole`, `member`, `invitation`, `account`, `passkey`, `twoFactor`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `verification`, `apikey`, `deviceCode`, `ssoProvider`, `auditTrailLogs`.
- Produces (`src/database/seeds/auth-tiers.seed.ts`): `authTiersSeeder: Seeder` (`name: 'auth-tiers'`) yang menyisipkan 4 tier (`tier_free`, `tier_basic`, `tier_business`, `tier_enterprise`) secara idempotent agar FK `tenant.tier_id -> auth_tiers.id` langsung valid sejak Fase 1.

- [ ] **Step 1: Write the failing tests**

Tulis `multitenant-schema.spec.ts` & `auth-tiers.seed.spec.ts`:

- Memverifikasi keberadaan kolom `tenantId` pada seluruh tabel target (`user`, `session`, `organization`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `verification`, `apikey`, `deviceCode`, `ssoProvider`, `auditTrailLogs`, serta child tables `account`, `passkey`, `twoFactor`, `member`, `invitation`, `organizationRole`), dan kolom `secrets` pada `authFeatureConfig` & `tenantAuthFeatureConfig`.
- Memverifikasi konfigurasi 6 partial `uniqueIndex(...).where(sql\`...\`)`pada`better-auth-user.ts` (`uq_user_platform_email`, `uq_user_tenant_email`, `uq_user_platform_username`, `uq_user_tenant_username`, `uq_user_platform_phone`, `uq_user_tenant_phone`) **(Review Focus #4)** dan composite `uq_organization_tenant_slug`di`better-auth-organization.ts`.
- Memverifikasi `authTiersSeeder` menghasilkan tepat 4 tier (`Free`, `Basic`, `Business`, `Enterprise` — tanpa `Pro`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd auth-core-api && bun test src/database/schema/multitenant-schema.spec.ts src/database/seeds/auth-tiers.seed.spec.ts`
Expected: FAIL because new tables, `tenantId` columns, and `authTiersSeeder` are missing.

- [ ] **Step 3: Implement schemas, rebuild Drizzle baseline migration, register `authTiersSeeder`, and keep legacy callers compilable**

Buat 5 file schema baru sesuai Spec §3.1, perbarui tabel eksisting sesuai Spec §3.2 (deklarasikan seluruh 6 partial unique index langsung di `better-auth-user.ts` menggunakan `uniqueIndex(...).on(...).where(sql\`...\`)`, tanpa edit manual SQL migrasi), buat `auth-tiers.seed.ts`dan daftarkan di`seed.ts`sebelum`adminSeeder`. Tambahkan penyesuaian kompilasi minimal sementara pada pemanggil eksisting (`auth-console.service.ts` dan `auth-feature-config.service.ts`) yang menyisipkan/membaca `organization.tenantId` dan `auth_feature_config` agar `bun run build` tetap hijau sebelum refactor Task 5 & Task 16. Hapus snapshot lama di `auth-core-api/drizzle/`dan jalankan`bun run db:generate`(verifikasi hasil SQL berisi`CREATE UNIQUE INDEX ... WHERE`).

- [ ] **Step 4: Run tests & build to verify schema compiles**

Run: `cd auth-core-api && bun test src/database/schema/multitenant-schema.spec.ts src/database/seeds/auth-tiers.seed.spec.ts && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/database/schema auth-core-api/src/database/seeds auth-core-api/src/database/seed.ts auth-core-api/drizzle
git commit -m "feat(db): define multi-tenant schema with TS partial unique indexes, baseline migration, and auth-tiers seed"
```

---

### Task 4: Security & IDOR Fixes, `PlatformPermissionGuard` & Hapus `Pro` Metadata

**Files:**

- Create: `auth-core-api/src/modules/rbac/decorators/require-platform-permission.decorator.ts`
- Create: `auth-core-api/src/modules/rbac/guards/platform-permission.guard.ts`
- Modify: `auth-core-api/src/modules/rbac/decorators/index.ts`
- Modify: `auth-core-api/src/modules/rbac/rbac.module.ts`
- Modify: `auth-core-api/src/modules/auth-console/services/auth-console.service.ts:308-346,667-864,948-1009,1208-1402`
- Modify: `auth-core-api/src/modules/auth-console/dto/auth-console.dto.ts`
- Modify: `auth-core-console/src/features/organizations/OrganizationsPage.tsx`
- Modify: `auth-core-console/src/components/better-auth/organization/CreateOrganizationDialog.tsx`
- Test: `auth-core-api/src/modules/rbac/guards/platform-permission.guard.spec.ts`

**Interfaces:**

- Consumes: `schema.user.tenantId` (dari Task 3)
- Produces:

  ```typescript
  export const RequirePlatformPermission = (permission: string) => MethodDecorator;
  export class PlatformPermissionGuard implements CanActivate { ... }
  ```

- [ ] **Step 1: Write the failing test**

Tulis test `platform-permission.guard.spec.ts`:

- Menolak user dengan `session.user.tenantId !== null` meskipun `role === 'admin'`.
- Mengizinkan `auditor` mengakses endpoint dengan `@RequirePlatformPermission('auditLog:read')`, tetapi menolak (`403`) saat mengakses `@RequirePlatformPermission('user:delete')` sesuai baris di `auth_core_role`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/rbac/guards/platform-permission.guard.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement guard & patch IDOR/secret bugs**

Implementasikan `PlatformPermissionGuard` membaca `auth_core_role.permissions`. Di `auth-console.service.ts`:

- Tambahkan filter `and(eq(organizationId, ...), eq(id, ...))` pada `updateOrganizationMemberRole`, `removeOrganizationMember`, dan `cancelOrganizationInvitation`.
- Hapus fallback password `'Admin12345!'` di `createUser` (wajib kirim password atau generate random token + undang reset).
- Hash `clientSecret` di `createOAuthClient` dan kembalikan `plainClientSecret` satu kali pada response create.
- Hapus `plan: 'Free' | 'Pro' | 'Enterprise'` dari `parseOrgMetadata`, `hydrateOrganization`, `CreateConsoleOrgDto`, dan UI `OrganizationsPage` / `CreateOrganizationDialog`.

- [ ] **Step 4: Run tests & lint to verify pass**

Run: `cd auth-core-api && bun test src/modules/rbac/guards/platform-permission.guard.spec.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/rbac auth-core-api/src/modules/auth-console auth-core-console/src
git commit -m "fix(security): enforce platform RBAC guard, fix org IDOR, remove legacy Pro org plan"
```

---

### Task 5: Refactor SOLID `auth-console` → `platform-console` (≤300 LOC/service & DB Pagination)

**Files:**

- Create: `auth-core-api/src/modules/platform-console/interfaces/platform-console-repositories.interface.ts`
- Create: `auth-core-api/src/modules/platform-console/repositories/platform-user.repository.ts`
- Create: `auth-core-api/src/modules/platform-console/repositories/platform-session.repository.ts`
- Create: `auth-core-api/src/modules/platform-console/repositories/platform-audit.repository.ts`
- Create: `auth-core-api/src/modules/platform-console/services/platform-users.service.ts`
- Create: `auth-core-api/src/modules/platform-console/services/platform-roles.service.ts`
- Create: `auth-core-api/src/modules/platform-console/services/platform-sessions.service.ts`
- Create: `auth-core-api/src/modules/platform-console/services/platform-audit.service.ts`
- Create: `auth-core-api/src/modules/platform-console/services/platform-metrics.service.ts`
- Create: `auth-core-api/src/modules/platform-console/controllers/platform-console.controller.ts`
- Create: `auth-core-api/src/modules/platform-console/platform-console.module.ts`
- Create: `auth-core-api/src/modules/platform-console/index.ts`
- Modify: `auth-core-api/src/app.module.ts`
- Delete (after wiring): `auth-core-api/src/modules/auth-console/services/auth-console.service.ts`
- Test: `auth-core-api/src/modules/platform-console/services/platform-users.service.spec.ts`

**Interfaces:**

- Consumes: `schema.user.tenantId` (dari Task 3)
- Produces (`src/modules/platform-console/interfaces/platform-console-repositories.interface.ts`):

  ```typescript
  export const PLATFORM_USER_REPOSITORY_TOKEN = Symbol(
    'PLATFORM_USER_REPOSITORY_TOKEN',
  );
  export const PLATFORM_SESSION_REPOSITORY_TOKEN = Symbol(
    'PLATFORM_SESSION_REPOSITORY_TOKEN',
  );
  export const PLATFORM_AUDIT_REPOSITORY_TOKEN = Symbol(
    'PLATFORM_AUDIT_REPOSITORY_TOKEN',
  );
  export interface IPlatformUserRepository {
    listPaginated(
      query: ListUsersQuery,
    ): Promise<{ items: User[]; total: number }>;
    findPlatformById(id: string): Promise<User | null>;
    createPlatformUser(input: CreatePlatformUserRecord): Promise<User>;
    updatePlatformUser(id: string, patch: Partial<User>): Promise<User>;
    deletePlatformUser(id: string): Promise<void>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Tulis `platform-users.service.spec.ts` dengan mock `IPlatformUserRepository` memverifikasi bahwa `listUsers` meneruskan filter & pagination ke repository (tanpa full-table scan) dan memfilter akun platform (`tenantId IS NULL`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/platform-console/services/platform-users.service.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `platform-console` SOLID module**

Pecah seluruh endpoint `/api/authcore/*` dari `AuthConsoleService` ke service terpisah (masing-masing ≤300 baris) + repository Drizzle memakai `LIMIT`/`OFFSET` dan `WHERE` SQL (`isNull(schema.user.tenantId)` untuk user platform — langsung compile clean karena Task 3 sudah berjalan). Delegasikan pembuatan API key ke plugin `@better-auth/api-key`, pasang `@RequirePlatformPermission(...)`, lalu ganti `AuthConsoleModule` di `AppModule` dengan `PlatformConsoleModule`.

- [ ] **Step 4: Run tests, lint, and build to verify pass**

Run: `cd auth-core-api && bun test src/modules/platform-console/ && bun run lint && bun run build`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/platform-console auth-core-api/src/app.module.ts
git commit -m "refactor(platform-console): split monolithic auth-console into SOLID services with DB pagination"
```

---

## Fase 1: Tenant, Billing Ledger & OAuth Client

### Task 6: Modul `tenant` (Immutable & Reserved Slugs) & Modul `billing`

**Files:**

- Create: `auth-core-api/src/modules/tenant/interfaces/tenant-repository.interface.ts`
- Create: `auth-core-api/src/modules/tenant/repositories/tenant.repository.ts`
- Create: `auth-core-api/src/modules/tenant/services/tenant.service.ts`
- Create: `auth-core-api/src/modules/tenant/controllers/operator-tenant.controller.ts`
- Create: `auth-core-api/src/modules/tenant/dto/tenant.dto.ts`
- Create: `auth-core-api/src/modules/tenant/tenant.module.ts`
- Create: `auth-core-api/src/modules/tenant/index.ts`
- Create: `auth-core-api/src/modules/billing/interfaces/billing-repository.interface.ts`
- Create: `auth-core-api/src/modules/billing/repositories/billing.repository.ts`
- Create: `auth-core-api/src/modules/billing/services/billing.service.ts`
- Create: `auth-core-api/src/modules/billing/controllers/operator-billing.controller.ts`
- Create: `auth-core-api/src/modules/billing/dto/billing.dto.ts`
- Create: `auth-core-api/src/modules/billing/billing.module.ts`
- Create: `auth-core-api/src/modules/billing/index.ts`
- Modify: `auth-core-api/src/app.module.ts`
- Test: `auth-core-api/src/modules/tenant/services/tenant.service.spec.ts`

**Interfaces:**

- Consumes: `schema.tenant`, `schema.authTiers` (sudah ter-seed sejak Task 3)
- Produces (`src/modules/tenant/interfaces/tenant-repository.interface.ts`):

  ```typescript
  export const TENANT_REPOSITORY_TOKEN = Symbol('TENANT_REPOSITORY_TOKEN');
  export const RESERVED_TENANT_SLUGS = [
    'auth',
    'console',
    'api',
    'admin',
    'www',
    't',
    'app',
    'docs',
    'mail',
    'status',
    'oauth',
    'sso',
    'scim',
    'billing',
    'static',
  ] as const;
  export interface TenantSummaryCache {
    id: string;
    slug: string;
    status: 'active' | 'suspended';
    tierId: string;
    configVersion: number;
  }
  export interface ITenantRepository {
    findById(id: string): Promise<TenantRow | null>;
    findBySlug(slug: string): Promise<TenantRow | null>;
    listPaginated(
      query: ListTenantsQuery,
    ): Promise<{ items: TenantRow[]; total: number }>;
    create(data: NewTenantRow): Promise<TenantRow>;
    update(id: string, patch: Partial<TenantRow>): Promise<TenantRow>;
    incrementConfigVersion(id: string): Promise<number>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Tambahkan unit test di `tenant.service.spec.ts`:

- Menolak pembuatan tenant dengan 15 reserved slugs (`auth`, `console`, `api`, `admin`, `www`, `t`, `app`, `docs`, `mail`, `status`, `oauth`, `sso`, `scim`, `billing`, `static`) dengan `400 INVALID_TENANT_SLUG` **(Review Focus #5)**.
- Upaya mengubah `slug` pada `updateTenant` ditolak `400 TENANT_SLUG_IMMUTABLE` **(Review Focus #5)**.
- Mengubah tier atau status `suspended` memperbarui Redis cache `authcore:tenant:slug:<slug>` dan menaikkan `configVersion`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/tenant/services/tenant.service.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `TenantModule` & `BillingModule`**

Implementasikan `TenantService`, `TenantRepository`, `OperatorTenantController` (`/api/admin/tenants` dengan `@RequirePlatformPermission`), serta `BillingService` dan `OperatorBillingController` (`/api/admin/billing`) untuk mencatat `tenant_billing_records` dan update `tenant.billingStatus`. Daftarkan di `AppModule`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/tenant/ src/modules/billing/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/tenant auth-core-api/src/modules/billing auth-core-api/src/app.module.ts
git commit -m "feat(tenant,billing): add SOLID tenant module with immutable/reserved slugs and billing ledger"
```

---

### Task 7: Modul `customer-portal` (Portal Pelanggan Amir & OAuth Client Terikat Tenant)

**Files:**

- Create: `auth-core-api/src/modules/customer-portal/guards/tenant-owner.guard.ts`
- Create: `auth-core-api/src/modules/customer-portal/interfaces/portal-oauth-client-repository.interface.ts`
- Create: `auth-core-api/src/modules/customer-portal/repositories/portal-oauth-client.repository.ts`
- Create: `auth-core-api/src/modules/customer-portal/services/customer-portal.service.ts`
- Create: `auth-core-api/src/modules/customer-portal/controllers/customer-portal.controller.ts`
- Create: `auth-core-api/src/modules/customer-portal/dto/customer-portal.dto.ts`
- Create: `auth-core-api/src/modules/customer-portal/customer-portal.module.ts`
- Create: `auth-core-api/src/modules/customer-portal/index.ts`
- Modify: `auth-core-api/src/app.module.ts`
- Test: `auth-core-api/src/modules/customer-portal/services/customer-portal.service.spec.ts`

**Interfaces:**

- Consumes: `TenantService`, `BillingService`
- Produces: Endpoints `/api/portal/tenants` (GET list milik owner, POST create), `/api/portal/tenants/:tenantId` (GET, PATCH name only — slug immutable), `/api/portal/tenants/:tenantId/oauth-clients` (GET, POST dengan one-time `plainClientSecret` + kuota tier `Free` maks 1 client), `DELETE /api/portal/tenants/:tenantId/oauth-clients/:clientId`, dan `GET /api/portal/tenants/:tenantId/billing`.

- [ ] **Step 1: Write the failing test**

Tulis `customer-portal.service.spec.ts`:

- `TenantOwnerGuard` menolak akses jika `session.user.tenantId !== null` atau `tenant.ownerUserId !== session.user.id`.
- `createTenantOAuthClient` mengisi `oauth_client.tenantId` = tenant tersebut, me-hash `clientSecret` sebelum simpan, mengembalikan `plainClientSecret` 1 kali, dan menolak client ke-2 pada tier `Free` (`403 TIER_CLIENT_LIMIT_REACHED`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/customer-portal/services/customer-portal.service.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `CustomerPortalModule`**

Implementasikan `TenantOwnerGuard`, `PortalOAuthClientRepository`, `CustomerPortalService` (≤300 baris), dan `CustomerPortalController`. Daftarkan di `AppModule`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/customer-portal/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/customer-portal auth-core-api/src/app.module.ts
git commit -m "feat(portal): add customer portal API for tenant and tenant-scoped OAuth clients"
```

---

### Task 8: Console UI — Operator Tenants/Billing & Portal Pelanggan Amir

**Files:**

- Create: `auth-core-console/src/api/tenant-service.ts`
- Create: `auth-core-console/src/features/admin-tenants/AdminTenantsPage.tsx`
- Create: `auth-core-console/src/features/admin-billing/AdminBillingPage.tsx`
- Create: `auth-core-console/src/features/portal/PortalTenantsPage.tsx`
- Create: `auth-core-console/src/features/portal/PortalTenantDetailPage.tsx`
- Create: `auth-core-console/src/routes/_authenticated/admin-tenants.tsx`
- Create: `auth-core-console/src/routes/_authenticated/admin-billing.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/index.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId.tsx`
- Modify: `auth-core-console/src/config/menus.ts`

**Interfaces:**

- Produces: Typed API client functions di `tenant-service.ts` (`listMyTenants`, `createMyTenant`, `listTenantOAuthClients`, `createTenantOAuthClient`, `deleteTenantOAuthClient`, `adminListTenants`, `adminUpdateTenantStatus`, `adminUpdateTenantTier`, `adminListBillingRecords`, `adminCreateBillingRecord`).

- [ ] **Step 1: Write route registration / UI smoke check**

Tambahkan route baru ke expected paths di `auth-core-console/scripts/routes.test.mjs` agar gagal sebelum route & menu dibuat.

- [ ] **Step 2: Run test:routes to verify it fails**

Run: `cd auth-core-console && bun run test:routes`
Expected: FAIL because new routes and menu entries are missing.

- [ ] **Step 3: Implement Portal Pelanggan & Operator Tenants/Billing UI**

Gunakan komponen UI eksisting di `components/ui/*` + TanStack Table + React Hook Form + Zod. Tampilkan `slug` sebagai read-only/immutable di detail tenant, tampilkan `plainClientSecret` dalam modal one-time reveal. Daftarkan menu di `config/menus.ts` (`mainNav`, `sidebarNav.modern`, `sidebarNav.classic`).

- [ ] **Step 4: Verify TypeScript, lint, routes, and build**

Run: `cd auth-core-console && bun run typecheck && bun run lint && bun run test:routes && bun run build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add auth-core-console/src auth-core-console/scripts/routes.test.mjs
git commit -m "feat(console): add operator tenants/billing pages and customer tenant portal"
```

---

## Fase 2: Fastify 5 `rewriteUrl` + Callback `onRequest`, User Pool Tenant & `better-auth-multi-tenant`

### Task 9: `createTenantRewriteUrl` + Callback `registerTenantResolverHook`, `better-auth-multi-tenant`, Cookie Mode Path & Isolasi OAuth 2.1

**Files:**

- Modify: `auth-core-api/package.json` (install `better-auth-multi-tenant`)
- Create: `auth-core-api/src/modules/tenant/context/tenant-context.storage.ts`
- Create: `auth-core-api/src/modules/tenant/hooks/register-tenant-resolver.hook.ts`
- Create: `auth-core-api/src/modules/auth/multi-tenant/tenant-auth-hooks.ts`
- Modify: `auth-core-api/src/main.ts` (pasang `rewriteUrl: createTenantRewriteUrl()` pada `new FastifyAdapter({ ... })` dan daftarkan `registerTenantResolverHook(app, ...)` sebelum `app.listen`)
- Modify: `auth-core-api/src/modules/auth/auth.ts`
- Test: `auth-core-api/src/modules/tenant/hooks/register-tenant-resolver.hook.spec.ts`
- Test: `auth-core-api/src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

**Interfaces:**

- Produces (`src/modules/tenant/context/tenant-context.storage.ts` & `src/modules/tenant/hooks/register-tenant-resolver.hook.ts`):

  ```typescript
  export interface ResolvedTenantContext {
    tenantId: string | null;
    slug: string | null;
    tierId: string | null;
    configVersion: number;
    source: 'platform' | 'subdomain' | 'path';
  }
  export class TenantContextStorage {
    static run<T>(ctx: ResolvedTenantContext, fn: () => T): T;
    static get(): ResolvedTenantContext;
  }
  export function createTenantRewriteUrl(): (
    req: IncomingMessage & { __tenantPathSlug?: string; __tenantOriginalUrl?: string },
  ) => string;
  export function registerTenantResolverHook(
    app: NestFastifyApplication,
    tenantLookup: (slug: string) => Promise<TenantSummaryCache | null>,
    platformHosts: string[],
  ): void;
  ```

- [ ] **Step 1: Write the failing tests**

Tulis `register-tenant-resolver.hook.spec.ts` & `tenant-auth-hooks.spec.ts`:

- **Review Focus #1 & #5 (Fastify 5 `rewriteUrl` + `req.raw.url` sync + callback `onRequest`):**
  - `createTenantRewriteUrl()` melepas `/t/<slug>` secara generik untuk **seluruh** `/t/<slug>/api/*` (`/api/auth/*`, `/api/context/*`, `/api/auth-config`, `/api/social-bridge/*`), menyimpan `req.__tenantPathSlug = slug` serta `req.__tenantOriginalUrl`, dan menormalisasi `req.raw.url` agar `@thallesp/nestjs-better-auth` menerima `/api/auth/*` yang cocok dengan `basePath: '/api/auth'` (tanpa `404`).
  - Callback `addHook('onRequest', (req, reply, done) => ...)` (bukan `async`) memanggil `TenantContextStorage.run(ctx, () => done())` di dalam `.then(...)`, mem-bypass `PLATFORM_HOSTS`, dan menolak tenant berstatus `suspended` dengan `403 TENANT_SUSPENDED`.
  - **Concurrent ALS Test:** Menjalankan 2 request paralel secara bersamaan (`/t/amir/api/...` dan `/t/bima/api/...`) membuktikan `TenantContextStorage.get()` di route handler Fastify dan raw handler Better Auth tidak pernah saling tertukar.
- **Review Focus #4 (Email/User Pool Isolation):** `signUp` di `ten_pos` mengisi `user.tenantId = 'ten_pos'`; email sama di `ten_bima` berhasil membuat user terpisah; email sama di `ten_pos` ditolak `409`.
- **Review Focus #1 & #2 (OAuth 2.1 + Cookie Prefix Mode Path):**
  - Instance mode path untuk `slug = 'pos-amir'` memakai `cookiePrefix = 'ac_t_pos-amir'` dan cookie attribute `path = '/t/pos-amir'` (Platform: `'ac_platform'`, `'/'`), sehingga login di `/t/bima` tidak menimpa cookie `/t/pos-amir`.
  - Endpoint OAuth `authorize` / `token` / `consent` / `introspect` / `revoke` menolak (`403 CROSS_TENANT_OAUTH_CLIENT`) bila `oauth_client.tenantId !== tenantContext.tenantId`.
  - Baris `session`, `verification`, `apikey`, `device_code`, `audit_trail_logs`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`, `account`, `passkey`, `two_factor` otomatis mempropagasikan `tenantId`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd auth-core-api && bun test src/modules/tenant/hooks/register-tenant-resolver.hook.spec.ts src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement Fastify 5 `rewriteUrl` + callback `onRequest`, `better-auth-multi-tenant`, cookie scoping & OAuth 2.1 guard**

Install `better-auth-multi-tenant`, implementasikan `createTenantRewriteUrl` (melepas `/t/<slug>` untuk seluruh `/t/<slug>/api/*` sekaligus menormalisasi `req.raw.url`) dan `registerTenantResolverHook` versi callback `addHook('onRequest', (req, reply, done) => ...)` di `main.ts`, pasang plugin `better-auth-multi-tenant` (`identity: "tenant"`, tanpa `getOrganizationId`), set `advanced.cookiePrefix` & cookie `path` per mode, dan pasang hook/guard validasi `oauth_client.tenantId` pada alur OAuth 2.1 + propagasi `tenantId` ke child tables.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/tenant/hooks/ src/modules/auth/multi-tenant/`
Expected: PASS (termasuk routing `/t/:slug/api/*` tanpa 404 & concurrent parallel test 2 tenant).

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/package.json auth-core-api/bun.lock auth-core-api/src/main.ts auth-core-api/src/modules/tenant auth-core-api/src/modules/auth
git commit -m "feat(auth,tenant): add Fastify 5 rewriteUrl + callback onRequest ALS resolver, path cookies, and OAuth guard"
```

---

### Task 10: `AuthRuntimeRegistry` (Shared Pools, `source`-Scoped LRU & O(1) `catalogVersion`)

**Files:**

- Create: `auth-core-api/src/modules/auth/auth-runtime.registry.ts`
- Modify: `auth-core-api/src/modules/auth/auth.module.ts`
- Modify: `auth-core-api/src/modules/auth/index.ts`
- Test: `auth-core-api/src/modules/auth/auth-runtime.registry.spec.ts`

**Interfaces:**

- Consumes: `TenantContextStorage`, `getSharedPool()`, `BETTER_AUTH_REDIS_CLIENT`
- Produces (`src/modules/auth/auth-runtime.registry.ts`):

  ```typescript
  export class AuthRuntimeRegistry {
    getForContext(ctx: ResolvedTenantContext): Promise<Auth>;
    invalidateTenant(tenantId: string, newVersion?: number): Promise<void>;
    invalidateCatalog(): Promise<number>;
    invalidatePlatform(): Promise<void>;
    createContextAwareProxy(): Auth;
  }
  ```

- [ ] **Step 1: Write the failing test**

Tulis `auth-runtime.registry.spec.ts` **(Review Focus #2)**:

- `getForContext` untuk `tenantId = null` mengembalikan `platformInstance`.
- Key LRU menggunakan **`${tenantId}:${source}:${configVersion}:${catalogVersion}`** (`source: 'subdomain' | 'path'`); mengakses tenant yang sama melalui `source: 'path'` dan `source: 'subdomain'` menghasilkan 2 instance terpisah dengan konfigurasi cookie `Path` & `baseURL` masing-masing.
- Saat `invalidateCatalog()` melakukan `INCR authcore:catalog:version` di Redis (O(1) tanpa menyentuh tabel `tenant`), lookup berikutnya membangun ulang instance tenant secara lazy.
- Memverifikasi seluruh instance di LRU memakai referensi `getSharedPool()` dan `BETTER_AUTH_REDIS_CLIENT` yang sama (tidak ada koneksi/pool baru per tenant).
- Default Passkey `rpID` untuk tenant mengacu ke `TENANT_BASE_DOMAIN` (`authcore.local` / `authcore.id`).
- Eviction LRU menghormati batas `AUTH_RUNTIME_LRU_MAX`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/auth/auth-runtime.registry.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `AuthRuntimeRegistry` & Redis Pub/Sub invalidation**

Implementasikan `AuthRuntimeRegistry` (pengganti `AuthRuntimeHolder` tunggal) dengan key `${tenantId}:${source}:${configVersion}:${catalogVersion}`, sambungkan ke Redis Pub/Sub channel `authcore:config:invalidated` memakai client Redis terdedikasi untuk subscriber, dan pasangkan `createContextAwareProxy()` ke `BetterAuthModule.forRootAsync` di `auth.module.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/auth/auth-runtime.registry.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/auth
git commit -m "feat(auth): replace AuthRuntimeHolder with source-scoped shared-pool AuthRuntimeRegistry"
```

---

### Task 11: Daftar User per Tenant (API Portal + Console UI)

**Files:**

- Create: `auth-core-api/src/modules/customer-portal/services/portal-tenant-users.service.ts`
- Modify: `auth-core-api/src/modules/customer-portal/controllers/customer-portal.controller.ts`
- Modify: `auth-core-console/src/api/tenant-service.ts`
- Create: `auth-core-console/src/features/portal/PortalTenantUsersTab.tsx`
- Modify: `auth-core-console/src/features/portal/PortalTenantDetailPage.tsx`
- Test: `auth-core-api/src/modules/customer-portal/services/portal-tenant-users.service.spec.ts`

**Interfaces:**

- Produces: `GET /api/portal/tenants/:tenantId/users` (paginated, filtered strictly `WHERE user.tenant_id = :tenantId`) dan `GET /api/admin/tenants/:tenantId/users` (operator).

- [ ] **Step 1: Write the failing test**

Tulis `portal-tenant-users.service.spec.ts` memverifikasi bahwa user milik `ten_bima` dan user platform (`tenantId = null`) tidak pernah muncul saat query `listTenantUsers('ten_amir', ...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/customer-portal/services/portal-tenant-users.service.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement tenant-scoped user listing API & Console tab**

Implementasikan repository query DB-level `WHERE tenant_id = :tenantId` dengan `LIMIT`/`OFFSET`, expose via `CustomerPortalController`, dan tambahkan tab Users pada `PortalTenantDetailPage`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/customer-portal/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/customer-portal auth-core-console/src
git commit -m "feat(portal): add strictly isolated per-tenant user listing API and UI"
```

---

## Fase 3: Organization dalam Tenant & POS Integration

### Task 12: `organization.tenant_id`, Relaksasi `canCreateOrganization`, Child Propagation & Cross-Tenant `RlsContext`

**Files:**

- Modify: `auth-core-api/src/modules/auth/organization-access.ts`
- Modify: `auth-core-api/src/shared/database/rls-context.ts`
- Modify: `auth-core-api/src/shared/database/rls.interceptor.ts`
- Modify: `auth-core-api/src/modules/auth/auth.ts` (hooks `organization`: inject & propagasi `tenantId` ke `organization`, `member`, `invitation`, `organization_role`, serta validasi `beforeSetActiveOrganization`)
- Create: `auth-core-api/src/modules/customer-portal/services/portal-tenant-orgs.service.ts`
- Modify: `auth-core-api/src/modules/customer-portal/controllers/customer-portal.controller.ts`
- Test: `auth-core-api/src/shared/database/rls.interceptor.spec.ts`
- Test: `auth-core-api/src/modules/auth/organization-access.spec.ts`

**Interfaces:**

- Produces (`src/shared/database/rls-context.ts`):

  ```typescript
  export interface RlsStore {
    tenantId: string | null;
    organizationId: string | null;
  }
  export class RlsContext {
    static run<T>(ctx: string | RlsStore, fn: () => T): T;
    static getCurrentTenantId(): string | null;
    static getCurrentOrganizationId(): string | null;
  }
  ```

- [ ] **Step 1: Write the failing tests**

- Update `organization-access.spec.ts`: user yang sudah memiliki role `'member'` di sebuah organization tetap mendapat `canCreateOrganization(...) === true` (dibatasi `organizationLimit` tenant).
- Update `rls.interceptor.spec.ts` **(Review Focus #1)**: jika `session.activeOrganizationId` menunjuk organization dengan `tenantId !== session.tenantId`, interceptor/hook menolak dengan `403 CROSS_TENANT_ORGANIZATION`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd auth-core-api && bun test src/modules/auth/organization-access.spec.ts src/shared/database/rls.interceptor.spec.ts`
Expected: FAIL on new assertions.

- [ ] **Step 3: Implement org tenant scoping, child `tenantId` propagation, `RlsContext` update, and portal org listing**

Perbarui `organization-access.ts`, `RlsContext`, `RlsInterceptor`, hook `organization` di `auth.ts` (isi `tenantId` pada `organization`, `member`, `invitation`, `organization_role`, validasi `beforeSetActiveOrganization`, dan pastikan invitation hanya dapat diterima pada tenant yang sama), plus endpoint read-only `GET /api/portal/tenants/:tenantId/organizations`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/auth/organization-access.spec.ts src/shared/database/rls.interceptor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/auth auth-core-api/src/shared/database auth-core-api/src/modules/customer-portal
git commit -m "feat(org): scope organizations and org child tables to tenant_id with cross-tenant guard"
```

---

### Task 13: Modul `tenant-context` & POS Integration (Short-TTL JWT Claims + Tenant API Key)

**Files:**

- Create: `auth-core-api/src/modules/tenant-context/guards/tenant-api-or-bearer.guard.ts`
- Create: `auth-core-api/src/modules/tenant-context/services/tenant-context.service.ts`
- Create: `auth-core-api/src/modules/tenant-context/controllers/tenant-context.controller.ts`
- Create: `auth-core-api/src/modules/tenant-context/dto/tenant-context.dto.ts`
- Create: `auth-core-api/src/modules/tenant-context/tenant-context.module.ts`
- Create: `auth-core-api/src/modules/tenant-context/index.ts`
- Modify: `auth-core-api/src/modules/auth/auth.ts` (`customSession` / OIDC claims hook untuk `tenant_id`, `active_organization_id`, `org_role`, `org_permissions` & kunci TTL access token ≤ 900s)
- Modify: `auth-core-api/src/app.module.ts`
- Test: `auth-core-api/src/modules/tenant-context/services/tenant-context.service.spec.ts`

**Interfaces:**

- Produces (`GET /api/context/session` & `/api/context/organizations/*` untuk Bearer Token user dan Tenant API Key):

  ```typescript
  export interface PosSessionContextDto {
    userId: string;
    tenantId: string;
    activeOrganizationId: string | null;
    orgRole: string | null;
    orgPermissions: string[];
  }
  ```

- [ ] **Step 1: Write the failing test**

Tulis `tenant-context.service.spec.ts`:

- `getSessionContext` untuk Asep mengembalikan `{ userId, tenantId: 'ten_pos', activeOrganizationId: 'org_warung', orgRole: 'owner', orgPermissions: [...] }` dan merefleksikan pencabutan role secara real-time.
- Konfigurasi JWT Access Token untuk tenant membatasi TTL `<= 900` detik (5–15 menit).
- Tenant API Key milik `ten_bima` ditolak (`403`) saat memanggil endpoint pada konteks `ten_pos`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/modules/tenant-context/services/tenant-context.service.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `TenantContextModule` & OIDC/JWT custom claims**

Implementasikan `TenantApiOrBearerGuard`, `TenantContextService`, dan `TenantContextController`, perkaya payload JWT/OIDC `oauthProvider` + `customSession` di `auth.ts`, dan kunci `accessTokenExpiresIn` / `jwt.expirationTime` maksimal 900 detik (15 menit).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/tenant-context/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/tenant-context auth-core-api/src/modules/auth/auth.ts auth-core-api/src/app.module.ts
git commit -m "feat(pos-integration): add short-TTL OIDC tenant claims, real-time TenantContext API, and Tenant API Key guard"
```

---

### Task 14: Console UI — Tenant Organizations Tab, `/consent` & `/auth/accept-invitation`

**Files:**

- Create: `auth-core-console/src/features/portal/PortalTenantOrgsTab.tsx`
- Create: `auth-core-console/src/features/auth/ConsentPage.tsx`
- Create: `auth-core-console/src/features/auth/AcceptInvitationPage.tsx`
- Create: `auth-core-console/src/routes/_auth/consent.tsx`
- Create: `auth-core-console/src/routes/_auth/auth/accept-invitation.tsx`
- Modify: `auth-core-console/src/features/portal/PortalTenantDetailPage.tsx`
- Modify: `auth-core-console/scripts/routes.test.mjs`

- [ ] **Step 1: Add expected routes to `routes.test.mjs`**

Tambahkan `/consent` dan `/auth/accept-invitation` ke `routes.test.mjs`.

- [ ] **Step 2: Run test:routes to verify it fails**

Run: `cd auth-core-console && bun run test:routes`
Expected: FAIL.

- [ ] **Step 3: Implement `/consent`, `/auth/accept-invitation`, dan tab Organizations pada Portal Tenant**

Gunakan `authClient.oauth2.consent(...)` dan `authClient.organization.acceptInvitation(...)` (dengan UI dari `components/ui/*`). Tambahkan tab Organizations pada `PortalTenantDetailPage` agar Amir bisa memantau workspace di tenant-nya tanpa masuk menjadi member org tersebut.

- [ ] **Step 4: Verify typecheck, lint, test:routes, and build**

Run: `cd auth-core-console && bun run typecheck && bun run lint && bun run test:routes && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-console/src auth-core-console/scripts/routes.test.mjs
git commit -m "feat(console): add OAuth consent, accept-invitation routes, and tenant orgs portal tab"
```

---

## Fase 4: Feature Management 4-Lapis, Tier & Encrypted Secrets

### Task 15: Seeder `feature-tier.seed.ts` (54 Fitur & Matriks `auth_tier_features` PRD §12)

**Files:**

- Create: `auth-core-api/src/database/seeds/feature-tier.seed.ts`
- Modify: `auth-core-api/src/database/seed.ts:1-10`
- Test: `auth-core-api/src/database/seeds/feature-tier.seed.spec.ts`

**Interfaces:**

- Consumes: `BETTER_AUTH_FEATURE_CATALOG`, 4 baris `auth_tiers` yang sudah di-seed idempotent oleh `authTiersSeeder` di Task 3
- Produces: `featureTierSeeder: Seeder` (`name: 'feature-tier'`), `buildTierFeatureMatrix(): Record<TierCode, BetterAuthFeatureId[]>`.

- [ ] **Step 1: Write the failing test**

Tulis `feature-tier.seed.spec.ts` memverifikasi:

- Seluruh 54 fitur dari `BETTER_AUTH_FEATURE_CATALOG` masuk ke baris seed `auth_features` (`autumn` berstatus `'coming_soon'`), dan field secret (seperti `clientSecret`, `secretKey`, `apiKey`, `webhookSecret`) didefinisikan dengan `type: 'secret'` di `availableSetting`.
- Pemetaan `auth_tier_features` untuk 4 tier (`Free`, `Basic`, `Business`, `Enterprise`) sesuai persis dengan matriks PRD §12.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd auth-core-api && bun test src/database/seeds/feature-tier.seed.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `feature-tier.seed.ts` & register in `seed.ts`**

Buat `featureTierSeeder` idempotent (upsert `auth_features` & `auth_tier_features` mengacu ke `auth_tiers` dari Task 3) dan tambahkan ke `defaultSeeders` di `src/database/seed.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/database/seeds/feature-tier.seed.spec.ts src/database/seed.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/database/seeds auth-core-api/src/database/seed.ts
git commit -m "feat(seed): add feature-tier seeder with 54 features and PRD tier matrix"
```

---

### Task 16: Modul `feature-tier` (4-Lapis Config, O(1) `catalogVersion`, Fail-Closed Downgrade & Secret Isolation)

**Files:**

- Create: `auth-core-api/src/modules/feature-tier/interfaces/feature-tier-repository.interface.ts`
- Create: `auth-core-api/src/modules/feature-tier/repositories/feature-tier.repository.ts`
- Create: `auth-core-api/src/modules/feature-tier/services/feature-catalog.service.ts`
- Create: `auth-core-api/src/modules/feature-tier/services/feature-resolution.service.ts`
- Create: `auth-core-api/src/modules/feature-tier/services/tenant-feature-config.service.ts`
- Create: `auth-core-api/src/modules/feature-tier/controllers/operator-feature-tier.controller.ts`
- Create: `auth-core-api/src/modules/feature-tier/dto/feature-tier.dto.ts`
- Create: `auth-core-api/src/modules/feature-tier/feature-tier.module.ts`
- Create: `auth-core-api/src/modules/feature-tier/index.ts`
- Modify: `auth-core-api/src/modules/customer-portal/controllers/customer-portal.controller.ts`
- Modify: `auth-core-api/src/modules/auth/auth.ts` (baca `secrets` terdekripsi + **no env fallback untuk tenant**)
- Modify: `auth-core-api/src/app.module.ts`
- Test: `auth-core-api/src/modules/feature-tier/services/feature-resolution.service.spec.ts`
- Test: `auth-core-api/src/modules/feature-tier/services/tenant-feature-config.service.spec.ts`

**Interfaces:**

- Consumes: `CryptoService`, `TenantService`, `AuthRuntimeRegistry`
- Produces (`src/modules/feature-tier/services/feature-resolution.service.ts`):

  ```typescript
  export interface ResolvedTenantFeatureRuntime {
    configMap: FeatureConfigMap;
    decryptedSecrets: Partial<
      Record<BetterAuthFeatureId, Record<string, string>>
    >;
    configVersion: number;
    catalogVersion: number;
  }
  export class FeatureResolutionService {
    resolveForPlatform(): Promise<ResolvedTenantFeatureRuntime>;
    resolveForTenant(
      tenantId: string,
      tierId: string,
    ): Promise<ResolvedTenantFeatureRuntime>;
    getPublicCapabilitiesForTenant(
      tenantId: string,
    ): Promise<PublicAuthConfigResponse>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

- **Review Focus #2 (`tenant-feature-config.service.spec.ts`):**
  - Menulis secret tanpa `AUTH_CONFIG_ENCRYPTION_KEY` ditolak (`400 ENCRYPTION_KEY_MISSING`).
  - Field bertipe `secret` di `availableSetting` dipindah ke kolom `secrets` terenkripsi dan dilarang masuk `settings`.
  - Input secret kosong tidak menimpa ciphertext lama; GET config hanya mengembalikan `secretsConfigured: Record<string, boolean>`.
  - `resolveForTenant` **tidak** mewarisi `process.env.GOOGLE_CLIENT_SECRET` saat ciphertext tenant kosong.
- **Review Focus #3 (`feature-resolution.service.spec.ts`):**
  - Menyalakan fitur di luar `tierId` atau fitur berstatus `disabled`/`coming_soon` ditolak `403 FEATURE_TIER_LOCKED` / `400 FEATURE_UNAVAILABLE`.
  - Mutasi status fitur / tier matrix memanggil `AuthRuntimeRegistry.invalidateCatalog()` (`INCR authcore:catalog:version`) tanpa bulk update baris tabel `tenant`.
  - Setelah tenant downgrade dari `Business` ke `Free` atau Operator menonaktifkan fitur, `resolveForTenant` menghasilkan `enabled: false` (fail-closed) sementara baris & `secrets` di `tenant_auth_feature_config` tidak terhapus dan aktif kembali saat upgrade.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd auth-core-api && bun test src/modules/feature-tier/`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `FeatureTierModule` & wire to `auth.ts` + `AuthRuntimeRegistry`**

Implementasikan repository, 3 service ≤300 baris, controller operator (`/api/admin/features`, `/api/admin/tiers`), dan endpoint portal (`/api/portal/tenants/:tenantId/features`, `GET/PUT`). Sambungkan `FeatureResolutionService` dengan Redis cache (`authcore:tenant:config:<tenantId>`, menyimpan ciphertext bukan plaintext) serta `AuthRuntimeRegistry.invalidateTenant(...)` / `invalidateCatalog()`. Perbarui `buildSocialProvidersConfig` & `buildPluginsConfig` di `auth.ts` agar membaca `decryptedSecrets` milik tenant tanpa fallback env platform.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/feature-tier/ src/modules/auth/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/feature-tier auth-core-api/src/modules/customer-portal auth-core-api/src/modules/auth auth-core-api/src/app.module.ts
git commit -m "feat(feature-tier): implement 4-layer feature catalog, O(1) catalogVersion, encrypted secrets, and fail-closed resolver"
```

---

### Task 17: Console UI — Operator Feature/Tier Matrix & Portal Tenant IAM Config

**Files:**

- Create: `auth-core-console/src/api/feature-tier-service.ts`
- Create: `auth-core-console/src/features/admin-tiers/AdminFeatureTierMatrixPage.tsx`
- Create: `auth-core-console/src/features/portal/PortalTenantFeaturesTab.tsx`
- Create: `auth-core-console/src/routes/_authenticated/admin-tiers.tsx`
- Modify: `auth-core-console/src/features/auth-features/AuthFeaturesPage.tsx` (support input `type="secret"` + badge `secretsConfigured`, hanya untuk config platform)
- Modify: `auth-core-console/src/features/portal/PortalTenantDetailPage.tsx`
- Modify: `auth-core-console/src/config/menus.ts`
- Modify: `auth-core-console/scripts/routes.test.mjs`

- [ ] **Step 1: Add `/admin-tiers` to `routes.test.mjs`**

Tambahkan assertion route baru di `routes.test.mjs`.

- [ ] **Step 2: Run test:routes to verify it fails**

Run: `cd auth-core-console && bun run test:routes`
Expected: FAIL.

- [ ] **Step 3: Implement Operator Matrix & Tenant IAM Feature Config UI**

Di `PortalTenantFeaturesTab.tsx`: tampilkan semua fitur katalog, badge `Locked (Butuh Tier X)` dan nonaktifkan switch untuk fitur di luar tier atau berstatus `disabled`/`coming_soon`; untuk field bertipe `secret`, render input password kosong dengan indikator `Terkonfigurasi` / `Belum diatur` (`secretsConfigured`) agar nilai kosong tidak menimpa secret lama.

- [ ] **Step 4: Verify typecheck, lint, test:routes, and build**

Run: `cd auth-core-console && bun run typecheck && bun run lint && bun run test:routes && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-console/src auth-core-console/scripts/routes.test.mjs
git commit -m "feat(console): add operator feature-tier matrix and tenant IAM secret configuration UI"
```

---

## Fase 5: Subdomain Wildcard, Central Social Callback Bridge & Hosted Login

### Task 18: Subdomain Wildcard pada `registerTenantResolverHook` & Central Social Bridge (One-Time Redis Exchange + Anti Open Redirect)

**Files:**

- Modify: `auth-core-api/src/modules/tenant/hooks/register-tenant-resolver.hook.ts` (tambahkan subdomain wildcard `<slug>.<TENANT_BASE_DOMAIN>` + mismatch check subdomain vs `/t/:slug`)
- Create: `auth-core-api/src/modules/auth/social-bridge/social-bridge.controller.ts`
- Create: `auth-core-api/src/modules/auth/social-bridge/social-bridge.service.ts`
- Modify: `auth-core-api/src/modules/auth/auth.module.ts`
- Test: `auth-core-api/src/modules/tenant/hooks/register-tenant-resolver.hook.spec.ts`
- Test: `auth-core-api/src/modules/auth/social-bridge/social-bridge.service.spec.ts`

**Interfaces:**

- Produces (`src/modules/auth/social-bridge/social-bridge.service.ts`):

  ```typescript
  export interface SocialExchangePayload {
    tenantId: string;
    tenantSlug: string;
    provider: string;
    providerAccountId: string;
    email: string;
    name: string;
    emailVerified: boolean;
    returnTo: string;
  }
  export class SocialBridgeService {
    createSignedState(input: {
      tenantId: string;
      tenantSlug: string;
      mode: 'subdomain' | 'path';
      provider: string;
      returnTo?: string;
    }): string;
    handleCentralCallback(input: {
      provider: string;
      code: string;
      state: string;
    }): Promise<{ redirectUrl: string }>;
    exchangeOnTenantHost(
      oneTimeCode: string,
      currentTenantId: string,
    ): Promise<{ sessionToken: string; redirectTo: string }>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

- Update `register-tenant-resolver.hook.spec.ts`: subdomain `pos-amir.authcore.local` me-resolve `ten_pos`; reserved host `auth.authcore.local` & `console.authcore.local` di-bypass ke Platform; gabungan `pos-amir.authcore.local/t/bima/...` ditolak `400 TENANT_MISMATCH`.
- Tulis `social-bridge.service.spec.ts` **(Review Focus #2)**:
  - `createSignedState` membentuk `returnOrigin` secara murni di server dari `tenantSlug`, `mode`, dan `TENANT_BASE_DOMAIN` / `BETTER_AUTH_URL` (tidak menerima `returnOrigin` dari input client), serta memvalidasi `returnTo` wajib berupa _relative path_ aman (`/^\//` dan bukan `//` — menolak `https://evil.com` dan `//evil.com` dengan `400 INVALID_RETURN_TO`).
  - `handleCentralCallback` di host pusat menukar code memakai secret tenant, menyimpan one-time exchange code di Redis (`TTL = 45s`), dan me-redirect ke `${returnOrigin}/api/social-bridge/exchange?code=...` (mode `subdomain`) atau `${returnOrigin}/t/${tenantSlug}/api/social-bridge/exchange?code=...` (mode `path`) di luar wildcard `/api/auth/*` Better Auth **tanpa** menerbitkan `Set-Cookie` sesi di host pusat.
  - `exchangeOnTenantHost` mengonsumsi code via `GETDEL` (replay ke-2 ditolak `401`), menolak jika `currentTenantId !== payload.tenantId` (`403`), menolak auto-link jika email sudah ada namun `emailVerified === false` (`403 UNVERIFIED_SOCIAL_EMAIL`), dan menerbitkan cookie _host-only_ pada host tenant.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd auth-core-api && bun test src/modules/tenant/hooks/register-tenant-resolver.hook.spec.ts src/modules/auth/social-bridge/social-bridge.service.spec.ts`
Expected: FAIL with missing subdomain/exchange behavior.

- [ ] **Step 3: Implement subdomain wildcard resolution & 2-step social bridge**

Lengkapi `registerTenantResolverHook` dengan parsing subdomain `<slug>.<TENANT_BASE_DOMAIN>` + mismatch check, dan implementasikan `SocialBridgeController` (`/api/social-bridge/start/:provider`, `/api/social-bridge/callback/:provider`, dan `/api/social-bridge/exchange` di luar `/api/auth/*`) + `SocialBridgeService`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd auth-core-api && bun test src/modules/tenant/hooks/ src/modules/auth/social-bridge/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-api/src/modules/tenant auth-core-api/src/modules/auth
git commit -m "feat(routing,social): add wildcard subdomain resolution and hardened social exchange bridge"
```

---

### Task 19: Hosted Tenant Auth Pages di `auth-core-console`

**Files:**

- Create: `auth-core-console/src/lib/tenant-context.ts`
- Create: `auth-core-console/src/features/tenant-auth/TenantAuthLayout.tsx`
- Create: `auth-core-console/src/features/tenant-auth/TenantAuthPages.tsx`
- Create: `auth-core-console/src/routes/t/$tenantSlug/login.tsx`
- Create: `auth-core-console/src/routes/t/$tenantSlug/register.tsx`
- Create: `auth-core-console/src/routes/t/$tenantSlug/verify-2fa.tsx`
- Create: `auth-core-console/src/routes/t/$tenantSlug/consent.tsx`
- Create: `auth-core-console/src/routes/t/$tenantSlug/accept-invitation.tsx`
- Modify: `auth-core-console/src/lib/auth-client.ts` (helper `createTenantAuthClient(tenantSlug)` mengarah ke `/t/${tenantSlug}/api/auth` atau origin subdomain)
- Modify: `auth-core-console/src/routes/_auth/login.tsx` (auto-detect subdomain tenant via `resolveTenantFromHostname`)
- Modify: `auth-core-console/scripts/routes.test.mjs`

- [ ] **Step 1: Add `/t/$tenantSlug/*` routes to `routes.test.mjs`**

Tambahkan assertion untuk route `/t/$tenantSlug/login`, `/t/$tenantSlug/register`, `/t/$tenantSlug/consent`, `/t/$tenantSlug/accept-invitation`.

- [ ] **Step 2: Run test:routes to verify it fails**

Run: `cd auth-core-console && bun run test:routes`
Expected: FAIL.

- [ ] **Step 3: Implement Hosted Tenant Auth Pages & Subdomain Auto-Detection**

Implementasikan `resolveTenantFromHostname`, `createTenantAuthClient`, fetch config tenant dari `GET /t/${slug}/api/auth-config` (atau `/api/auth-config` pada subdomain), dan render halaman login/register/2fa/consent/accept-invitation hanya dengan metode autentikasi yang aktif & diizinkan tier tenant itu.

- [ ] **Step 4: Verify typecheck, lint, test:routes, and build**

Run: `cd auth-core-console && bun run typecheck && bun run lint && bun run test:routes && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth-core-console/src auth-core-console/scripts/routes.test.mjs
git commit -m "feat(console): add hosted tenant auth pages for /t/:slug and subdomain access"
```

---

### Task 20: E2E Acceptance Suite (12 Persyaratan Fungsional PRD §16 & 5 Kriteria PRD §19)

**Files:**

- Create: `auth-core-api/test/multitenant-acceptance.e2e-spec.ts`

- [ ] **Step 1: Write acceptance test suite**

Tulis skenario terpadu memverifikasi seluruh PRD §16 & §19 serta 5 item Review Focus:

1. Amir, Bima, Citra mendaftar sebagai akun platform (`tenantId === null`), membuat tenant (`pos-amir`, `sekolah-bima`, `pos-citra`) dengan slug immutable dan OAuth client terikat `tenant_id`.
2. Asep mendaftar di `pos-amir` dan membuat organization `Warung Asep` (`owner`), sedangkan Amir **tidak** muncul di tabel `member` organization tersebut; Asep dengan email sama juga bisa mendaftar di `sekolah-bima` sebagai user berbeda.
3. Asep mengundang `budi@warung.id`; sebelum undangan diterima Budi belum menjadi member; setelah Budi menerima undangan, Budi menjadi `user` pada `pos-amir` dan `member` di `Warung Asep`.
4. Daftar user & organization tenant Amir tidak menampakkan data Bima/Citra; `setActiveOrganization` silang tenant ditolak `403`; OAuth `authorize`/`token` memakai `client_id` milik Bima di host/path Amir ditolak `403`.
5. Amir menyalakan Google OAuth + secret terenkripsi pada `pos-amir` (tier `Business`); tenant Bima dan Console Platform tidak berubah; fitur di luar tier ditolak `403`; secret tidak bocor di response `GET`; social bridge callback melakukan one-time exchange di host tenant (dengan `/t/:slug` pada mode path) dengan cookie _host-only_ & menolak auto-link email tak terverifikasi; mode `/t/:slug` menjaga cookie terpisah per tenant; concurrent request 2 tenant menjaga ALS tetap terisolasi.
6. POS membaca `user_id`, `tenant_id`, `active_organization_id`, dan `org_role` dari token (TTL ≤ 15 menit) maupun API real-time `/api/context/session`.

- [ ] **Step 2: Run full verification suite across API & Console**

Run:

```bash
cd auth-core-api && bun test && bun run lint && bun run build
cd ../auth-core-console && bun run typecheck && bun run lint && bun run test:routes && bun run build
```

Expected: All tests, lint checks, route checks, and builds PASS (100% green).

- [ ] **Step 3: Commit**

```bash
git add auth-core-api/test/multitenant-acceptance.e2e-spec.ts
git commit -m "test(e2e): verify all PRD functional requirements and multi-tenant acceptance criteria"
```
