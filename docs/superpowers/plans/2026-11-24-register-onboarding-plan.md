# Register, Alternatif Auth, dan Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelaraskan halaman register platform & tenant (form + social/passkey), mengarahkan pemilik baru tanpa tenant ke `/platform/onboarding`, dan menyelesaikan wizard pembuatan tenant pertama.

**Architecture:** Modul `features/auth/register/` menjadi sumber form email dan blok alternatif. `AuthView` SIGN_UP dan `TenantRegisterPage` hanya meng-orkestrasi. Route `/platform/onboarding` mengecualikan guard operator di parent platform, memakai layout minimal tanpa sidebar via `_authenticated`, dan memanggil `createMyTenant` yang sudah ada.

**Tech Stack:** React 19, TanStack Router, RHF, Zod, Zustand, Better Auth client, Bun test.

**Spec:** [2026-11-24-register-onboarding-design.md](../specs/2026-11-24-register-onboarding-design.md)

## Global Constraints

- Perubahan hanya di `auth-core-console` kecuali ditemukan regresi API yang mengharuskan penyesuaian minor.
- Halaman hosted `/t/:slug/*` tidak mengubah kontrak path; hanya parity UX register.
- Copy UI Bahasa Indonesia.
- Setelah file route berubah: `cd auth-core-console && bunx vite build` lalu `bun run typecheck`.
- Auto sign-in setelah register tidak diubah kecuali redirect.
- Onboarding wajib: tidak ada “lewati” untuk owner dengan nol tenant.

## File Structure

| File | Tanggung jawab |
| --- | --- |
| `src/features/auth/register/schema.ts` | `buildRegisterSchema`, types |
| `src/features/auth/register/RegisterEmailForm.tsx` | Form RHF reusable |
| `src/features/auth/register/RegisterAlternativeMethods.tsx` | Platform vs tenant alternatif |
| `src/features/auth/register/register-schema.test.ts` | Uji schema dinamis |
| `src/features/onboarding/PlatformOnboardingPage.tsx` | UI wizard tenant |
| `src/routes/_authenticated/platform/onboarding.tsx` | Route definition |
| `src/lib/console-home.ts` | Gate onboarding di redirect |
| `src/lib/owner-onboarding.ts` | Helper `needsOwnerOnboarding()` |
| `src/lib/owner-onboarding.test.ts` | Uji helper |
| `src/routes/_authenticated/platform/route.tsx` | Pengecualian guard + layout |
| `src/routes/_authenticated.tsx` | Layout minimal untuk onboarding |
| `src/routes/_authenticated/tenants/index.tsx` | Redirect ke onboarding |
| `src/components/better-auth/auth/SignUpForm.tsx` | Tipis, pakai modul register |
| `src/components/better-auth/auth/AuthView.tsx` | SIGN_UP + alternatif |
| `src/features/tenant-auth/TenantAuthPages.tsx` | Refactor `TenantRegisterPage` |

---

### Task 1: Schema register dinamis + uji

**Files:**

- Create: `auth-core-console/src/features/auth/register/schema.ts`
- Create: `auth-core-console/src/features/auth/register/register-schema.test.ts`

- [ ] **Step 1:** Tulis test gagal untuk `buildRegisterSchema({ minPasswordLength: 10, maxPasswordLength: 64 })` menolak password 8 karakter.
- [ ] **Step 2:** Jalankan `cd auth-core-console && bun test src/features/auth/register/register-schema.test.ts` — harus gagal.
- [ ] **Step 3:** Implement `buildRegisterSchema`; export `RegisterValues`.
- [ ] **Step 4:** Jalankan test — hijau.

---

### Task 2: `RegisterEmailForm`

**Files:**

- Create: `auth-core-console/src/features/auth/register/RegisterEmailForm.tsx`
- Modify: `auth-core-console/src/features/auth/schema.ts` — re-export atau deprecate `registerSchema` statis menuju `buildRegisterSchema` default 8/128

- [ ] **Step 1:** Ekstrak markup dari `SignUpForm.tsx` ke `RegisterEmailForm` dengan props `onSubmit`, `usernameEnabled`, `hibpEnabled`, `idPrefix`, `defaultValues`.
- [ ] **Step 2:** Refactor `SignUpForm` memakai komponen baru + `buildRegisterSchema` dari store config platform (`emailAndPassword.settings`).
- [ ] **Step 3:** Manual smoke: `/register` form masih submit.

---

### Task 3: Alternatif auth di register platform

**Files:**

- Create: `auth-core-console/src/features/auth/register/RegisterAlternativeMethods.tsx`
- Modify: `auth-core-console/src/components/better-auth/auth/AuthView.tsx`

- [ ] **Step 1:** Implement mode `platform`: separator + `PasskeyButton` + `ProviderButtons` (salin kondisi `hasAlternativeProviders` dari login).
- [ ] **Step 2:** Sisipkan di blok `SIGN_UP` setelah form email / pesan disabled.
- [ ] **Step 3:** Manual: aktifkan Google di config → tombol muncul di register.

---

### Task 4: Register tenant — parity + alternatif

**Files:**

- Modify: `auth-core-console/src/features/tenant-auth/TenantAuthPages.tsx`

- [ ] **Step 1:** Ganti state mentah dengan `RegisterEmailForm` + schema dari config tenant.
- [ ] **Step 2:** Ekstrak helper social/passkey dari login (fungsi kecil di file yang sama atau shared) → `RegisterAlternativeMethods` mode `tenant`.
- [ ] **Step 3:** Manual: `/t/{slug}/register` submit + social bridge dengan `?redirect=`.

---

### Task 5: Helper redirect onboarding

**Files:**

- Create: `auth-core-console/src/lib/owner-onboarding.ts`
- Create: `auth-core-console/src/lib/owner-onboarding.test.ts`
- Modify: `auth-core-console/src/lib/console-home.ts`

- [ ] **Step 1:** Test: `needsOwnerOnboarding(actor, ownedCount)` — true hanya untuk non-platform actor, `tenantId` null, count 0.
- [ ] **Step 2:** Implement helper; mock `listMyTenants` di `resolvePostAuthRedirect` branch.
- [ ] **Step 3:** Update `SignUpForm` / flow register tetap memakai `resolvePostAuthRedirect` — verifikasi owner baru menuju `/platform/onboarding`.

---

### Task 6: Route & layout `/platform/onboarding`

**Files:**

- Create: `auth-core-console/src/features/onboarding/PlatformOnboardingPage.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/onboarding.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/platform/route.tsx`
- Modify: `auth-core-console/src/routes/_authenticated.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/tenants/index.tsx`

- [ ] **Step 1:** `PlatformOnboardingPage` — card DashTail, form name/slug, `createMyTenant`, navigate `/tenants/$tenantId`.
- [ ] **Step 2:** `onboarding.tsx` route + `beforeLoad` guard (operator → `/platform`, punya tenant → home).
- [ ] **Step 3:** `platform/route.tsx` — skip `isPlatformActor` bila pathname onboarding; jangan wrap `PlatformShell` untuk child onboarding (gunakan context dari child atau cek pathname).
- [ ] **Step 4:** `_authenticated.tsx` — render `<Outlet />` saja jika pathname `/platform/onboarding`.
- [ ] **Step 5:** `tenants/index.tsx` — jika nol tenant, redirect `/platform/onboarding`.
- [ ] **Step 6:** `bunx vite build && bun run typecheck`.

---

### Task 7: Route registry test

**Files:**

- Modify: `auth-core-console/scripts/routes.test.mjs`

- [ ] **Step 1:** Tambah `/platform/onboarding` ke daftar route platform yang wajib ada.
- [ ] **Step 2:** `cd auth-core-console && bun run test:routes` (atau perintah yang dipakai repo).

---

### Task 8: Verifikasi manual akhir

- [ ] Register platform (email) → onboarding → buat tenant → masuk shell tenant.
- [ ] Register platform (OAuth) → onboarding bila belum punya tenant.
- [ ] Operator buka `/platform/onboarding` → redirect `/platform`.
- [ ] Register tenant tidak mempengaruhi onboarding platform.

---

## Risiko & mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Parent `platform/route.tsx` selalu memanggil `ensureActorPermissions` | Cabang onboarding tidak memanggil API izin operator |
| Double fetch `listMyTenants` | Cache query key `portal-tenants` 1 item di redirect |
| File `TenantAuthPages.tsx` besar | Hanya ekstrak blok register; jangan refactor login sekaligus |