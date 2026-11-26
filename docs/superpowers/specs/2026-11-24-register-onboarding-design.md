# Design Document: Register, Alternatif Auth, dan Onboarding Tenant

- **Tanggal:** 24 November 2026
- **Status:** Approved
- **Spec terkait:** [2026-11-24-auth-core-multitenant-design.md](./2026-11-24-auth-core-multitenant-design.md), [2026-11-24-console-shell-navigation-design.md](./2026-11-24-console-shell-navigation-design.md)
- **Kode yang disentuh:** `auth-core-console` (register platform & tenant, redirect pasca-auth, route `/platform/onboarding`). **Tidak** mengubah kontrak API backend kecuali penyesuaian kompilasi minor tidak diperlukan.

Dokumen ini merapikan alur **daftar akun** di dua permukaan hosted/console dan menambahkan **onboarding wajib** untuk pemilik tenant yang belum memiliki tenant setelah registrasi platform. Auto sign-in setelah register dianggap sudah benar; fokus pada parity UX, metode alternatif di halaman register, dan pengalihan ke pembuatan tenant pertama.

---

## 1. Masalah

### 1.1 Register platform (`/register`)

- Form email memakai `SignUpForm` (RHF + Zod) dengan username opsional dan hint Have I Been Pwned.
- Halaman **SIGN_UP** di `AuthView` **tidak** menampilkan Passkey, Social OAuth, One Tap, atau metode alternatif lain yang sudah ada di halaman login.
- Setelah sukses, `resolvePostAuthRedirect` mengarahkan pemilik tanpa tenant ke `/tenants` (daftar kosong + dialog create tersembunyi), bukan alur onboarding yang jelas.

### 1.2 Register tenant (`/t/:tenantSlug/register` dan subdomain)

- Form memakai state React mentah, validasi hanya HTML (`minLength={8}`), tanpa username, tanpa Zod yang selaras dengan config tier.
- Tidak ada blok alternatif (social, passkey) seperti pada `TenantLoginPage`.
- Redirect pasca-register tetap ke `redirect` query, URL Better Auth, atau login tenant — **tidak** terhubung ke onboarding platform.

### 1.3 Onboarding

- Belum ada route dedicated. Referensi UI: DashTail [`onboarding/page.tsx`](file:///home/amirmufid/projects/boilerplate/dash-tail-free/app/onboarding/page.tsx) — kartu tengah, judul + subjudul, konten fokus pada satu tindakan utama (bukan tiga “workspace” generik).

---

## 2. Aktornya dan guard

| Aktornya | Register | Onboarding `/platform/onboarding` |
| --- | --- | --- |
| Operator platform (`isPlatformActor`) | Boleh via `/register`; setelah auth → `/platform` | **Ditolak** → redirect `/platform` |
| Pemilik tenant baru (`tenant_id` null, role `user`, belum punya tenant) | `/register` | **Target** — fullscreen wizard buat tenant |
| Pemilik yang sudah punya tenant | `/register` (jarang) | Redirect `resolveConsoleHome` |
| End-user tenant (`tenant_id` set) | Hosted `/t/:slug/register` | Tidak masuk console onboarding |

Onboarding memenuhi kebutuhan minimum sistem untuk portal pelanggan: **`POST /api/portal/tenants`** (`createMyTenant`) dengan `name` + `slug`, sehingga `owner_user_id` terikat dan owner dapat masuk shell `/tenants/:tenantId`.

Organisasi, OAuth client, dan API key **tidak** masuk wizard ini (tetap di shell tenant setelah onboarding).

---

## 3. Keputusan yang dikunci

1. **Pendekatan B — modul terpadu:** `features/auth/register/` untuk form email + alternatif; `features/onboarding/` untuk halaman tenant pertama. Hindari duplikasi antara `SignUpForm` dan `TenantRegisterPage`.
2. **URL onboarding:** `/platform/onboarding` (satu grup path dengan route platform lain).
3. **Layout onboarding:** Tanpa `PlatformShell` (tanpa sidebar operator). Fullscreen center card ala DashTail, di bawah pohon `_authenticated` tetapi **bukan** di dalam chrome shell operator.
4. **Parent `/platform`:** `beforeLoad` pada `platform/route.tsx` memberi pengecualian untuk path onboarding bagi pemilik tenant; halaman operator tetap memerlukan `isPlatformActor` + `PlatformShell`.
5. **Redirect pasca register platform:** `?redirect=` aman → prioritas; operator → `/platform`; pemilik tanpa tenant → `/platform/onboarding`; lainnya → `resolveConsoleHome`.
6. **Register tenant:** Perbaikan parity + alternatif auth; **tanpa** mengubah journey onboarding platform.
7. **Social di register:** Memakai pola Better Auth yang sama seperti login (akun dibuat pada OAuth pertama kali bila belum ada); bridge tenant memakai `getTenantSocialBridgeStartUrl` dengan `redirectTo` yang sama.
8. **Onboarding wajib:** Tidak ada link “lewati” sampai tenant berhasil dibuat (owner baru yang sudah punya ≥1 tenant tidak lagi melihat halaman ini).

---

## 4. Register — form email bersama

### 4.1 Modul `features/auth/register/`

| Unit | Tanggung jawab |
| --- | --- |
| `buildRegisterSchema(input)` | Zod: `name`, `email`, `password`, `username?`; `min`/`max` password dari config `emailAndPassword` |
| `RegisterEmailForm` | UI + RHF; props: `onSubmit`, `usernameEnabled`, `hibpEnabled`, `disabled`, `idPrefix` |
| `RegisterAlternativeMethods` | Separator + Passkey (platform) + social (platform `ProviderButtons` / tenant bridge) |

`SignUpForm` menjadi wrapper tipis: `useAuthStore.signUp` + toast + redirect.

`TenantRegisterPage` memanggil `tenantClient.signUp.email` dengan field yang sama setelah validasi Zod dari config tenant (`useTenantAuthSetup`).

### 4.2 Error handling

- Better Auth / API: toast dengan `res.error.message`; field-level jika pesan cocok dengan validasi Zod.
- 409 email duplikat, rate limit, feature disabled: pesan bahasa Indonesia yang konsisten antara platform dan tenant.

### 4.3 Username

- Platform: tampil jika `features.username.enabled`.
- Tenant: tampil hanya jika config efektif tenant mengaktifkan fitur username **dan** API signup tenant menerima field tersebut (jika belum didukung runtime, sembunyikan field — jangan kirim key orphan).

---

## 5. Register — metode alternatif

### 5.1 Platform (`AuthView` view `SIGN_UP`)

Setelah blok form email (atau pesan email disabled), tambahkan blok yang setara dengan login:

- Kondisi: `hasAlternativeProviders` (sama seperti login).
- Komponen: `PasskeyButton`, `ProviderButtons` dengan `redirectTo` yang disanitasi.
- Tampilkan separator “Atau lanjutkan dengan” hanya jika ada metode utama (email) **dan** alternatif.

### 5.2 Tenant

Ekstrak logika alternatif dari login (`activeSocials`, `passkeyEnabled`, `handleSocialSignIn`, passkey handler) ke komponen bersama atau `RegisterAlternativeMethods` mode `tenant`.

Pasang di `TenantRegisterPage` setelah form email bila `emailAndPassword` aktif; jika email disabled tetapi ada alternatif, tampilkan hanya alternatif (mirip login).

---

## 6. Route dan layout `/platform/onboarding`

### 6.1 File

- `auth-core-console/src/routes/_authenticated/platform/onboarding.tsx`
- `auth-core-console/src/features/onboarding/PlatformOnboardingPage.tsx`

### 6.2 Perilaku `platform/route.tsx`

```text
beforeLoad:
  if (location.pathname === '/platform/onboarding'):
    - require session (sudah di _authenticated)
    - if isPlatformActor → redirect /platform
    - fetch owned tenants (listMyTenants pageSize 1)
    - if count > 0 → redirect resolveConsoleHome
    - return { onboarding: true }  // tanpa ensureActorPermissions operator
  else:
    - existing guard isPlatformActor + permissions
```

```text
component:
  if route context onboarding OR child is onboarding only:
    render <Outlet /> without PlatformShell
  else:
    render <PlatformShell><Outlet /></PlatformShell>
```

Implementasi konkret boleh memakai route context flag `layout: 'minimal'` dari child onboarding, asal hanya `/platform/onboarding` yang memakainya.

### 6.3 UI onboarding

- Layout: `min-h-screen flex items-center justify-center`, `Card` `max-w-[580px]`, padding 8–9.
- Judul: “Buat tenant pertama Anda”.
- Subjudul: satu kalimat tentang hosted auth dan console tenant.
- Form: `name`, `slug` dengan auto-slugify (`slugifyTenantName`), validasi `createPortalTenantSchema` (reuse dari portal).
- Bantuan: preview URL hosted `/t/{slug}` (read-only).
- Submit: `createMyTenant` → toast sukses → navigate `/tenants/$tenantId`.

Tidak memakai tiga kartu “workspace” DashTail; hanya meminjam **kerangka visual** (card centered).

### 6.4 `_authenticated` layout

Onboarding harus tampil fullscreen seperti DashTail **tanpa** sidebar console.

**Keputusan:** di `src/routes/_authenticated.tsx`, jika `location.pathname === '/platform/onboarding'`, render hanya `<Outlet />` (tanpa `ConsoleSidebar`, `Header`, `Footer`). Route lain tidak berubah. Sesi tetap dilindungi `beforeLoad` yang sudah ada.

---

## 7. Redirect dan integrasi

### 7.1 `resolvePostAuthRedirect`

Tambah cabang sebelum `resolveAuthenticatedHome`:

```ts
// Pseudocode
if (!redirectTo?.trim()) {
  const actor = toConsoleActor(user);
  if (!isPlatformActor(actor)) {
    const page = await listMyTenants({ page: 0, pageSize: 1 });
    if (page.total === 0) return '/platform/onboarding';
  }
}
```

Hindari panggilan ganda: pertimbangkan helper `resolveOwnerOnboardingGate()`.

### 7.2 Guard masuk console

Setelah login/register, jika user non-operator mengakses `/tenants` dengan nol tenant, **redirect** ke `/platform/onboarding` (selaras dengan onboarding wajib). Implementasi di `tenants/index.tsx` `beforeLoad` atau helper bersama dengan onboarding route.

### 7.3 Tenant register

Tidak memanggil onboarding. Tetap: `navigateAfterAuth` / login tenant.

---

## 8. Pengujian

| Area | Verifikasi |
| --- | --- |
| Unit | `buildRegisterSchema` dengan min/max berbeda; slug onboarding invalid |
| Route | Script atau test: `/platform/onboarding` terdaftar; operator redirect |
| Manual | Register platform → onboarding → create → shell tenant; register tenant + social; email disabled hanya alternatif |

Tambahkan assert di `scripts/routes.test.mjs` jika pola repo mengharuskan daftar route platform.

---

## 9. Out of scope

- Verifikasi email sebagai langkah wizard terpisah (hormati flag Better Auth yang ada).
- OAuth client / API key di onboarding.
- Multi-tenant owner dengan banyak tenant — onboarding hanya untuk **nol** tenant.
- Perubahan backend `createTenant` selain yang sudah ada di customer portal.

---

## 10. Referensi kode saat ini

| Lokasi | Peran |
| --- | --- |
| `src/routes/_auth/register.tsx` | Register platform / subdomain embedded |
| `src/components/better-auth/auth/SignUpForm.tsx` | Form platform |
| `src/components/better-auth/auth/AuthView.tsx` | SIGN_UP tanpa alternatif |
| `src/features/tenant-auth/TenantAuthPages.tsx` | `TenantRegisterPage` |
| `src/lib/console-home.ts` | `resolvePostAuthRedirect` |
| `src/routes/_authenticated/platform/route.tsx` | Guard operator |
| `src/features/portal/schema.ts` | `createPortalTenantSchema` |