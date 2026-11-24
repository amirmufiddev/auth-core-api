# Console Shell per Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memisahkan console menjadi shell platform (`/platform`) dan shell tenant (`/tenants/:tenantId`), dengan menu serta tombol yang mengikuti izin role platform dan mode dukungan baca-saja.

**Architecture:** API menambah `GET /api/admin/me/permissions` yang mengembalikan matriks `auth_core_role` milik sesi tanpa `role:read`. Console memecah navigasi menjadi fungsi murni (`isPlatformActor`, `canPlatform`, `resolveConsoleHome`, `resolveTenantMode`, `redirectLegacyPath`, `filterNav`) plus dua layout TanStack Router. Halaman yang sudah ada pindah route. Tab detail tenant menjadi route anak. Guard API tidak diganti kuncinya.

**Tech Stack:** TypeScript, NestJS 11, Fastify 5, Drizzle, Bun test, React 19, Vite, TanStack Router, TanStack Query, Zustand.

**Spec:** [2026-11-24-console-shell-navigation-design.md](../specs/2026-11-24-console-shell-navigation-design.md)

## Global Constraints

- Dua repo git. Task 1 commit di `auth-core-api` pada branch yang sedang berjalan. Task 2–8 commit di `auth-core-console`. Jangan mencampur file kedua repo dalam satu commit.
- Kunci izin API tetap: `organization:read`, `organization:create`, `organization:update`, `user:*`, `role:*`, `session:*`, `auditLog:*`, `authConfig:read`, `authConfig:configure`. Jangan menambah resource `tenant` atau `billing`.
- `organization:read` membuka direktori tenant, billing ledger, dan mode dukungan. `organization:update` membuka catat entri billing, suspend, aktifkan, dan ganti tier. `authConfig:configure` membuka Feature & Tier Matrix, termasuk GET yang sudah ada.
- Aktor platform tidak pernah mode tulis di shell tenant. Impersonate hanya di `/platform/staff` bila ada `user:impersonate`.
- Ringkasan billing tenant tetap baca-saja. Perubahan ledger hanya di `/platform/billing`.
- Izin `apiKey`, `oauthClient`, dan `sso` tidak membuka menu platform dan tidak ditampilkan di matriks halaman Role Platform. Data yang sudah tersimpan tidak dihapus.
- Halaman `/t/:slug/*` tidak diubah.
- Service baru di API tetap di bawah 300 baris. Copy UI tetap Bahasa Indonesia.
- Setelah file route console berubah, jalankan `bunx vite build` di `auth-core-console` sebelum `bun run typecheck`, karena plugin TanStack Router menulis `src/routeTree.gen.ts` pada build Vite, sedangkan `bun run build` menjalankan `tsc -b` lebih dulu.

## File Structure

- `auth-core-api/src/modules/platform-console/services/platform-actor-permissions.service.ts` — memuat matriks role milik user platform. Menolak akun yang `findPlatformById` tidak temukan (termasuk akun bertenant).
- `auth-core-api/src/modules/platform-console/services/platform-actor-permissions.service.spec.ts` — uji service.
- `auth-core-api/src/modules/platform-console/controllers/actor-permissions.controller.ts` — `GET /api/admin/me/permissions`, tanpa `@RequirePlatformPermission`.
- `auth-core-api/src/modules/platform-console/controllers/actor-permissions.controller.spec.ts` — uji 401 dan ketiadaan metadata izin.
- `auth-core-console/src/lib/console-shell.ts` — fungsi murni shell, izin, rumah login, mode tenant, redirect, dan filter menu.
- `auth-core-console/src/lib/console-shell.test.ts` — uji Bun untuk fungsi itu.
- `auth-core-console/src/config/menus.ts` — katalog `platformNav` dan `tenantNav(tenantId)`.
- `auth-core-console/src/lib/rbac.ts` — label matriks platform dan flag `shownInPlatformMatrix`.
- `auth-core-console/src/components/layout/PlatformShell.tsx` — sidebar platform.
- `auth-core-console/src/components/layout/TenantShell.tsx` — sidebar tenant, banner dukungan, switcher tenant.
- `auth-core-console/src/components/layout/ShellState.tsx` — keadaan tidak berwenang dan tidak ditemukan.
- `auth-core-console/src/components/layout/Can.tsx` — `Can` untuk tombol platform dan `OwnerOnly` untuk tombol tenant.
- Route baru di `auth-core-console/src/routes/_authenticated/platform/**` dan `tenants/$tenantId/**`. Route lama menjadi redirect.

---

### Task 1: Endpoint matriks izin aktor

**Files:**

- Create: `auth-core-api/src/modules/platform-console/services/platform-actor-permissions.service.ts`
- Create: `auth-core-api/src/modules/platform-console/services/platform-actor-permissions.service.spec.ts`
- Create: `auth-core-api/src/modules/platform-console/controllers/actor-permissions.controller.ts`
- Create: `auth-core-api/src/modules/platform-console/controllers/actor-permissions.controller.spec.ts`
- Modify: `auth-core-api/src/modules/platform-console/platform-console.module.ts`
- Modify: `auth-core-api/src/modules/platform-console/services/platform-users.service.ts` (tambah `tenantId: null` pada hasil `getMe`)
- Test: `auth-core-api/src/modules/platform-console/services/platform-users.service.spec.ts`

**Interfaces:**

- Consumes: `IPlatformUserRepository.findPlatformById`, `IPlatformRoleRepository.findBySlug`, `PLATFORM_USER_REPOSITORY_TOKEN`, `PLATFORM_ROLE_REPOSITORY_TOKEN`
- Produces:
  - `PlatformActorPermissionsService.getMine(userId: string): Promise<{ roles: Array<{ slug: string; permissions: Record<string, string[]> }> }>`
  - `GET /api/admin/me/permissions` body sama dengan nilai kembalian `getMine`
  - `getMe` ikut mengembalikan `tenantId: null`

- [ ] **Step 1: Write the failing service test**

Buat `platform-actor-permissions.service.spec.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { PlatformActorPermissionsService } from './platform-actor-permissions.service';

function serviceWith(opts: {
  user: { id: string; role: string | null } | null;
  roles: Record<string, Record<string, string[]>>;
}) {
  const userRepo = {
    findPlatformById: mock(() => Promise.resolve(opts.user)),
  };
  const roleRepo = {
    findBySlug: mock((slug: string) =>
      Promise.resolve(
        opts.roles[slug]
          ? { slug, permissions: opts.roles[slug] }
          : null,
      ),
    ),
  };
  return new PlatformActorPermissionsService(
    userRepo as never,
    roleRepo as never,
  );
}

describe('PlatformActorPermissionsService', () => {
  it('returns matrices for each stored role slug without requiring role:read', async () => {
    const service = serviceWith({
      user: { id: 'usr_1', role: 'security_admin,auditor' },
      roles: {
        security_admin: { session: ['read', 'revoke'], organization: ['read'] },
        auditor: { auditLog: ['read', 'export'] },
      },
    });

    await expect(service.getMine('usr_1')).resolves.toEqual({
      roles: [
        {
          slug: 'security_admin',
          permissions: { session: ['read', 'revoke'], organization: ['read'] },
        },
        {
          slug: 'auditor',
          permissions: { auditLog: ['read', 'export'] },
        },
      ],
    });
  });

  it('omits a slug that has no auth_core_role row', async () => {
    const service = serviceWith({
      user: { id: 'usr_1', role: 'ghost,auditor' },
      roles: { auditor: { auditLog: ['read'] } },
    });

    await expect(service.getMine('usr_1')).resolves.toEqual({
      roles: [{ slug: 'auditor', permissions: { auditLog: ['read'] } }],
    });
  });

  it('rejects tenant-scoped and unknown users', async () => {
    const service = serviceWith({ user: null, roles: {} });
    await expect(service.getMine('usr_tenant')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run dari `auth-core-api`:

```bash
bun test src/modules/platform-console/services/platform-actor-permissions.service.spec.ts
```

Expected: FAIL karena modul service belum ada.

- [ ] **Step 3: Implement the service**

`platform-actor-permissions.service.ts`:

```typescript
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type IPlatformRoleRepository,
  type IPlatformUserRepository,
  PLATFORM_ROLE_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from '../interfaces';

export interface ActorRolePermissions {
  slug: string;
  permissions: Record<string, string[]>;
}

@Injectable()
export class PlatformActorPermissionsService {
  constructor(
    @Inject(PLATFORM_USER_REPOSITORY_TOKEN)
    private readonly userRepo: IPlatformUserRepository,
    @Inject(PLATFORM_ROLE_REPOSITORY_TOKEN)
    private readonly roleRepo: IPlatformRoleRepository,
  ) {}

  async getMine(userId: string): Promise<{ roles: ActorRolePermissions[] }> {
    const user = await this.userRepo.findPlatformById(userId);
    if (!user) {
      throw new ForbiddenException(
        'Hanya akun platform yang dapat mengakses fitur ini.',
      );
    }

    const slugs = (user.role ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);

    const roles: ActorRolePermissions[] = [];
    for (const slug of slugs) {
      const row = await this.roleRepo.findBySlug(slug);
      if (!row) continue;
      roles.push({
        slug: row.slug,
        permissions: row.permissions ?? {},
      });
    }

    return { roles };
  }
}
```

- [ ] **Step 4: Run the service test to verify it passes**

```bash
bun test src/modules/platform-console/services/platform-actor-permissions.service.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing controller test**

`actor-permissions.controller.spec.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PLATFORM_PERMISSION_META_KEY } from '@/modules/rbac';
import { PlatformConsoleModule } from '../platform-console.module';
import { ActorPermissionsController } from './actor-permissions.controller';

describe('ActorPermissionsController', () => {
  it('returns the service payload for a session and rejects a missing session', async () => {
    const service = {
      getMine: mock(() =>
        Promise.resolve({
          roles: [{ slug: 'auditor', permissions: { auditLog: ['read'] } }],
        }),
      ),
    };
    const controller = new ActorPermissionsController(service as never);

    await expect(
      controller.getPermissions({ user: { id: 'usr_1', email: 'a@b.c' } }),
    ).resolves.toEqual({
      roles: [{ slug: 'auditor', permissions: { auditLog: ['read'] } }],
    });
    expect(service.getMine).toHaveBeenCalledWith('usr_1');

    await expect(controller.getPermissions(null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not require a platform permission and is registered on the module', () => {
    const permission = Reflect.getMetadata(
      PLATFORM_PERMISSION_META_KEY,
      ActorPermissionsController.prototype.getPermissions,
    );
    expect(permission).toBeUndefined();

    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PlatformConsoleModule,
    ) as unknown[];
    expect(controllers).toContain(ActorPermissionsController);
  });
});
```

- [ ] **Step 6: Run the controller test to verify it fails**

```bash
bun test src/modules/platform-console/controllers/actor-permissions.controller.spec.ts
```

Expected: FAIL karena controller belum ada.

- [ ] **Step 7: Implement the controller and register it**

`actor-permissions.controller.ts`:

```typescript
import {
  Controller,
  Get,
  UnauthorizedException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import { PlatformActorPermissionsService } from '../services/platform-actor-permissions.service';

interface AuthSessionContext {
  user?: { id: string; email?: string; role?: string | null };
}

@ApiTags('Operator / Actor Permissions')
@ApiBearerAuth()
@Controller({ path: 'api/admin/me', version: VERSION_NEUTRAL })
export class ActorPermissionsController {
  constructor(private readonly service: PlatformActorPermissionsService) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'Matriks izin role platform milik akun yang sedang login',
  })
  async getPermissions(@Session() session: AuthSessionContext | null) {
    if (!session?.user?.id) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }
    return this.service.getMine(session.user.id);
  }
}
```

Di `platform-console.module.ts`, import controller dan service, lalu tambahkan `ActorPermissionsController` pada array `controllers` dan `PlatformActorPermissionsService` pada array `providers`.

Di `platform-users.service.ts`, pada objek yang dikembalikan `getMe`, tambahkan field `tenantId: null` tepat setelah `id`.

Di `platform-users.service.spec.ts`, pada assertion objek `getMe` yang sudah ada, tambahkan `tenantId: null` agar tes lama tetap lulus.

- [ ] **Step 8: Run the API tests**

```bash
bun test src/modules/platform-console/controllers/actor-permissions.controller.spec.ts src/modules/platform-console/services/platform-actor-permissions.service.spec.ts src/modules/platform-console/services/platform-users.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit di auth-core-api**

```bash
git add src/modules/platform-console/services/platform-actor-permissions.service.ts \
  src/modules/platform-console/services/platform-actor-permissions.service.spec.ts \
  src/modules/platform-console/controllers/actor-permissions.controller.ts \
  src/modules/platform-console/controllers/actor-permissions.controller.spec.ts \
  src/modules/platform-console/platform-console.module.ts \
  src/modules/platform-console/services/platform-users.service.ts \
  src/modules/platform-console/services/platform-users.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(rbac): expose the signed-in platform role matrix

Console navigation has to filter menus without role:read, so the actor can read only their own auth_core_role rows.
EOF
)"
```

---

### Task 2: Fungsi murni shell console

**Files:**

- Create: `auth-core-console/src/lib/console-shell.ts`
- Create: `auth-core-console/src/lib/console-shell.test.ts`
- Modify: `auth-core-console/package.json` script `test:routes`

**Interfaces:**

- Produces dari `src/lib/console-shell.ts`:
  - `ConsoleActor = { role: string | null; tenantId: string | null }`
  - `ActorRoleGrant = { slug: string; permissions: Record<string, string[]> }`
  - `ConsoleMenuItem = { title: string; href?: string; permission?: { resource: string; action: string }; child?: ConsoleMenuItem[] }`
  - `isPlatformActor(actor: ConsoleActor): boolean`
  - `canPlatform(roles: ActorRoleGrant[], resource: string, action: string): boolean`
  - `resolveConsoleHome(input: { actor: ConsoleActor; ownedTenantIds: string[] }): string`
  - `TenantShellMode = "owner" | "support" | "denied" | "not_found"`
  - `resolveTenantMode(input: { isPlatform: boolean; portalStatus: "owner" | "forbidden" | "not_found"; canReadTenants: boolean }): TenantShellMode`
  - `redirectLegacyPath(input: { path: string; actor: ConsoleActor; ownedTenantIds: string[] }): string`
  - `filterNav(items: ConsoleMenuItem[], can: (resource: string, action: string) => boolean): ConsoleMenuItem[]`

- [ ] **Step 1: Write the failing test**

Buat `src/lib/console-shell.test.ts` dengan `bun:test`. Kasus yang wajib ada:

```typescript
import { describe, expect, it } from "bun:test";
import {
  canPlatform,
  filterNav,
  isPlatformActor,
  redirectLegacyPath,
  resolveConsoleHome,
  resolveTenantMode,
} from "./console-shell";

const platform = { role: "super_admin", tenantId: null };
const owner = { role: "user", tenantId: null };
const blank = { role: null, tenantId: null };
const endUser = { role: null, tenantId: "ten_1" };

describe("console shell", () => {
  it("treats a non-user platform slug as a platform actor", () => {
    expect(isPlatformActor(platform)).toBe(true);
    expect(isPlatformActor({ role: "user,security_admin", tenantId: null })).toBe(true);
    expect(isPlatformActor(owner)).toBe(false);
    expect(isPlatformActor(blank)).toBe(false);
    expect(isPlatformActor(endUser)).toBe(false);
  });

  it("matches PlatformPermissionGuard wildcards", () => {
    expect(canPlatform([{ slug: "a", permissions: { organization: ["read"] } }], "organization", "read")).toBe(true);
    expect(canPlatform([{ slug: "a", permissions: { organization: ["*"] } }], "organization", "update")).toBe(true);
    expect(canPlatform([{ slug: "a", permissions: { "*": ["read"] } }], "auditLog", "read")).toBe(true);
    expect(canPlatform([{ slug: "a", permissions: { user: ["read"] } }], "organization", "read")).toBe(false);
  });

  it("resolves the login home", () => {
    expect(resolveConsoleHome({ actor: platform, ownedTenantIds: [] })).toBe("/platform");
    expect(resolveConsoleHome({ actor: owner, ownedTenantIds: ["ten_1"] })).toBe("/tenants/ten_1");
    expect(resolveConsoleHome({ actor: owner, ownedTenantIds: ["ten_1", "ten_2"] })).toBe("/tenants");
    expect(resolveConsoleHome({ actor: blank, ownedTenantIds: [] })).toBe("/tenants");
  });

  it("never gives a platform actor owner write mode", () => {
    expect(resolveTenantMode({ isPlatform: true, portalStatus: "owner", canReadTenants: true })).toBe("support");
    expect(resolveTenantMode({ isPlatform: true, portalStatus: "forbidden", canReadTenants: false })).toBe("denied");
    expect(resolveTenantMode({ isPlatform: true, portalStatus: "not_found", canReadTenants: true })).toBe("not_found");
    expect(resolveTenantMode({ isPlatform: false, portalStatus: "owner", canReadTenants: false })).toBe("owner");
    expect(resolveTenantMode({ isPlatform: false, portalStatus: "forbidden", canReadTenants: false })).toBe("denied");
  });

  it("filters menu items by read permission and keeps overview", () => {
    const items = [
      { title: "Overview", href: "/platform" },
      { title: "Tenants", href: "/platform/tenants", permission: { resource: "organization", action: "read" } },
      { title: "Staf", href: "/platform/staff", permission: { resource: "user", action: "read" } },
    ];
    expect(filterNav(items, (resource) => resource === "user").map((item) => item.href)).toEqual([
      "/platform",
      "/platform/staff",
    ]);
  });

  it("redirects legacy paths from the spec table", () => {
    expect(redirectLegacyPath({ path: "/users", actor: platform, ownedTenantIds: [] })).toBe("/platform/staff");
    expect(redirectLegacyPath({ path: "/tenants", actor: platform, ownedTenantIds: [] })).toBe("/platform/tenants");
    expect(redirectLegacyPath({ path: "/tenants/ten_9", actor: platform, ownedTenantIds: [] })).toBe("/tenants/ten_9");
    expect(redirectLegacyPath({ path: "/api-keys", actor: platform, ownedTenantIds: [] })).toBe("/platform");
    expect(redirectLegacyPath({ path: "/users", actor: owner, ownedTenantIds: ["ten_1"] })).toBe("/tenants/ten_1/users");
    expect(redirectLegacyPath({ path: "/roles", actor: owner, ownedTenantIds: ["ten_1", "ten_2"] })).toBe("/tenants");
    expect(redirectLegacyPath({ path: "/account", actor: owner, ownedTenantIds: [] })).toBe("/tenants");
    expect(redirectLegacyPath({ path: "/account", actor: owner, ownedTenantIds: ["ten_1"] })).toBe("/tenants/ten_1/account");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Dari `auth-core-console`:

```bash
bun test src/lib/console-shell.test.ts
```

Expected: FAIL, cannot find module `./console-shell`.

- [ ] **Step 3: Implement `console-shell.ts`**

```typescript
export interface ConsoleActor {
  role: string | null;
  tenantId: string | null;
}

export interface ActorRoleGrant {
  slug: string;
  permissions: Record<string, string[]>;
}

export interface ConsoleMenuItem {
  title: string;
  href?: string;
  permission?: { resource: string; action: string };
  child?: ConsoleMenuItem[];
}

export type TenantShellMode = "owner" | "support" | "denied" | "not_found";

export function roleSlugs(role: string | null): string[] {
  return (role ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

export function isPlatformActor(actor: ConsoleActor): boolean {
  if (actor.tenantId) return false;
  return roleSlugs(actor.role).some((slug) => slug !== "user");
}

export function canPlatform(
  roles: ActorRoleGrant[],
  resource: string,
  action: string,
): boolean {
  return roles.some((role) => {
    const matrix = role.permissions ?? {};
    const resourceActions = matrix[resource];
    const wildcardActions = matrix["*"];
    return (
      (Array.isArray(resourceActions) &&
        (resourceActions.includes(action) || resourceActions.includes("*"))) ||
      (Array.isArray(wildcardActions) &&
        (wildcardActions.includes(action) || wildcardActions.includes("*")))
    );
  });
}

export function resolveConsoleHome(input: {
  actor: ConsoleActor;
  ownedTenantIds: string[];
}): string {
  if (isPlatformActor(input.actor)) return "/platform";
  if (input.ownedTenantIds.length === 1) {
    return `/tenants/${input.ownedTenantIds[0]}`;
  }
  return "/tenants";
}

export function resolveTenantMode(input: {
  isPlatform: boolean;
  portalStatus: "owner" | "forbidden" | "not_found";
  canReadTenants: boolean;
}): TenantShellMode {
  if (input.portalStatus === "not_found") return "not_found";
  if (input.isPlatform) {
    return input.canReadTenants ? "support" : "denied";
  }
  if (input.portalStatus === "owner") return "owner";
  return "denied";
}

const PLATFORM_EXACT: Record<string, string> = {
  "/dashboard": "/platform",
  "/users": "/platform/staff",
  "/roles": "/platform/roles",
  "/sessions": "/platform/sessions",
  "/audit-logs": "/platform/audit",
  "/auth-features": "/platform/auth-features",
  "/api-keys": "/platform",
  "/organizations": "/platform",
  "/admin-tenants": "/platform/tenants",
  "/admin-tiers": "/platform/tiers",
  "/admin-billing": "/platform/billing",
  "/account": "/platform/account",
};

export function redirectLegacyPath(input: {
  path: string;
  actor: ConsoleActor;
  ownedTenantIds: string[];
}): string {
  const path = input.path.split("?")[0] ?? input.path;
  if (isPlatformActor(input.actor)) {
    if (path === "/tenants" || path === "/tenants/") return "/platform/tenants";
    if (path.startsWith("/tenants/")) return path;
    return PLATFORM_EXACT[path] ?? "/platform";
  }

  const only =
    input.ownedTenantIds.length === 1 ? input.ownedTenantIds[0] : null;
  if (path === "/users" && only) return `/tenants/${only}/users`;
  if (path === "/api-keys" && only) return `/tenants/${only}/api-keys`;
  if (path === "/organizations" && only) {
    return `/tenants/${only}/organizations`;
  }
  if (path === "/account") {
    return only ? `/tenants/${only}/account` : "/tenants";
  }
  if (path === "/tenants" || path.startsWith("/tenants/")) return path;
  return resolveConsoleHome(input);
}

export function filterNav(
  items: ConsoleMenuItem[],
  can: (resource: string, action: string) => boolean,
): ConsoleMenuItem[] {
  return items.flatMap((item) => {
    if (item.permission && !can(item.permission.resource, item.permission.action)) {
      return [];
    }
    if (item.child) {
      const child = filterNav(item.child, can);
      if (child.length === 0 && !item.href) return [];
      return [{ ...item, child }];
    }
    return [item];
  });
}
```

Ubah script `test:routes` di `package.json` menjadi:

```json
"test:routes": "bun test src/lib/console-shell.test.ts && node --test scripts/routes.test.mjs"
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/lib/console-shell.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit di auth-core-console**

```bash
git add src/lib/console-shell.ts src/lib/console-shell.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(console): add pure shell navigation rules

Login home, tenant mode, and legacy redirects need one tested decision point before the routes move.
EOF
)"
```

---

### Task 3: Katalog menu dan label matriks

**Files:**

- Modify: `auth-core-console/src/config/menus.ts`
- Modify: `auth-core-console/src/lib/rbac.ts`
- Modify: `auth-core-console/src/features/roles/RolesPage.tsx`
- Modify: `auth-core-console/scripts/routes.test.mjs`
- Test: `auth-core-console/scripts/routes.test.mjs`

**Interfaces:**

- Consumes: `ConsoleMenuItem.permission` dari Task 2. `MenuItemProps` yang sudah ada boleh ditambah field opsional `permission?: { resource: string; action: string }`.
- Produces:
  - `platformNav: MenuItemProps[]` dengan href dan permission pada tabel spec bagian 3.1
  - `tenantNav(tenantId: string): MenuItemProps[]` dengan sembilan href spec bagian 3.2
  - `RBAC_RESOURCE_MODULES[].shownInPlatformMatrix: boolean`
  - `RolesPage` merender hanya modul yang `shownInPlatformMatrix` true

- [ ] **Step 1: Write the failing route-catalog test**

Di `scripts/routes.test.mjs`, ganti daftar `required` pada tes menu menjadi:

```javascript
for (const required of [
  "/platform",
  "/platform/tenants",
  "/platform/tiers",
  "/platform/billing",
  "/platform/staff",
  "/platform/roles",
  "/platform/sessions",
  "/platform/audit",
  "/platform/auth-features",
  "/platform/account",
]) {
  assert.ok(
    platformHrefs.includes(required),
    `Menu platform harus mendaftarkan ${required}`,
  );
}

for (const removed of ["/users", "/organizations", "/api-keys", "/dashboard", "/admin-tenants"]) {
  assert.equal(
    platformHrefs.includes(removed),
    false,
    `Menu platform tidak boleh mendaftarkan ${removed}`,
  );
}
```

Tambah tes baru:

```javascript
test("tenantNav memasang sembilan menu di bawah id tenant", () => {
  const source = readUtf8("src/config/menus.ts");
  assert.match(source, /export function tenantNav\(tenantId: string\)/);
  for (const suffix of [
    "",
    "/settings",
    "/features",
    "/oauth-clients",
    "/api-keys",
    "/users",
    "/organizations",
    "/billing",
    "/account",
  ]) {
    assert.match(
      source,
      new RegExp("`/tenants/\\$\\{tenantId\\}" + suffix.replace("/", "\\/") + "`"),
    );
  }
});

test("matriks role platform menyembunyikan apiKey, oauthClient, dan sso", () => {
  const source = readUtf8("src/lib/rbac.ts");
  for (const resource of ["apiKey", "oauthClient", "sso"]) {
    const block = source.slice(source.indexOf(`resource: "${resource}"`));
    assert.match(block, /shownInPlatformMatrix:\s*false/);
  }
  assert.match(source, /title: "Staf platform"/);
  assert.match(source, /title: "Direktori tenant & billing"/);
  assert.match(source, /title: "Plugin layanan & matriks tier"/);
});
```

Sesuaikan tes lama yang memaksa `mainNav`, `sidebarNav.modern`, dan `sidebarNav.classic` berisi href `/dashboard` agar membandingkan `platformNav` dengan dirinya sendiri. Hapus kewajiban href lama. Biarkan tes larangan Next.js dan katalog fitur Better Auth.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/routes.test.mjs
```

Expected: FAIL karena `platformNav` dan `tenantNav` belum ada.

- [ ] **Step 3: Implement catalogs and labels**

Ganti isi navigasi `menus.ts`. Pertahankan `MenuItemProps`, icon, dan `collectMenuHrefs`. Tambah `permission` opsional. Ekspor `platformNav` dan `tenantNav`. `menusConfig` boleh tetap ada sebagai alias `platformNav` supaya import lama tidak putus pada commit ini, tetapi href di dalamnya harus href platform baru, bukan href lama.

`platformNav` item dan permission:

| title | href | permission |
| --- | --- | --- |
| Overview | `/platform` | tidak ada |
| Tenants | `/platform/tenants` | `organization:read` |
| Feature & Tier Matrix | `/platform/tiers` | `authConfig:configure` |
| Billing Ledger | `/platform/billing` | `organization:read` |
| Staf Platform | `/platform/staff` | `user:read` |
| Role Platform | `/platform/roles` | `role:read` |
| Sesi Staf | `/platform/sessions` | `session:read` |
| Audit Platform | `/platform/audit` | `auditLog:read` |
| Auth Features | `/platform/auth-features` | tidak ada. `PlatformShell` pada Task 4 menambah item ini bila `canPlatform(roles, "authConfig", "read")` atau `canPlatform(roles, "authConfig", "configure")` |
| Akun | `/platform/account` | tidak ada |

`tenantNav`:

```typescript
export function tenantNav(tenantId: string): MenuItemProps[] {
  const base = `/tenants/${tenantId}`;
  return [
    { title: "Ringkasan", href: base, icon: LayoutDashboard },
    { title: "Pengaturan", href: `${base}/settings`, icon: SlidersHorizontal },
    { title: "IAM Features", href: `${base}/features`, icon: SlidersHorizontal },
    { title: "OAuth 2.1 / MCP", href: `${base}/oauth-clients`, icon: KeyRound },
    { title: "API Keys", href: `${base}/api-keys`, icon: KeyRound },
    { title: "Users", href: `${base}/users`, icon: Users },
    { title: "Organizations", href: `${base}/organizations`, icon: Building2 },
    { title: "Billing", href: `${base}/billing`, icon: CreditCard },
    { title: "Akun", href: `${base}/account`, icon: UserCog },
  ];
}
```

Di `rbac.ts`, tambah `shownInPlatformMatrix: boolean` pada `RbacResourceModule`. Set `false` untuk `apiKey`, `oauthClient`, dan `sso`. Set `true` untuk yang lain. Ganti title:

- `user` → `Staf platform`
- `session` → `Sesi staf`
- `role` → `Role platform`
- `organization` → `Direktori tenant & billing`
- `authConfig` → `Plugin layanan & matriks tier`
- `auditLog` → `Audit platform`

Di `RolesPage.tsx`, saat merender `RBAC_RESOURCE_MODULES`, filter `shownInPlatformMatrix`. Jangan ubah payload yang dikirim ke API saat menyimpan role: izin tersembunyi yang sudah ada di state tetap ikut tersimpan. Jangan tampilkan checkbox baru untuk tiga resource itu.

- [ ] **Step 4: Run the catalog test**

```bash
node --test scripts/routes.test.mjs
```

Expected: PASS. Tes "setiap href memiliki file route" boleh masih gagal sampai Task 4 membuat file route. Jika tes itu gagal hanya karena file `/platform/*` belum ada, longgarkan tes itu pada step ini agar href `/platform...` dianggap sah bila file route ada **atau** href masih belum dipindah. Pada Task 4, kembalikan tes menjadi wajib: setiap href `platformNav` dan pola `tenantNav` punya file route.

- [ ] **Step 5: Commit di auth-core-console**

```bash
git add src/config/menus.ts src/lib/rbac.ts src/features/roles/RolesPage.tsx scripts/routes.test.mjs
git commit -m "$(cat <<'EOF'
feat(console): split platform and tenant menu catalogs

The role matrix labels now match the platform shell, and tenant screens are no longer items on that menu.
EOF
)"
```

---

### Task 4: Layout shell, header, dan route platform

**Files:**

- Create: `auth-core-console/src/components/layout/ShellState.tsx`
- Create: `auth-core-console/src/components/layout/PlatformShell.tsx`
- Create: `auth-core-console/src/api/actor-permissions.ts`
- Create: `auth-core-console/src/routes/_authenticated/platform/route.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/index.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/tenants.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/tiers.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/billing.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/staff.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/roles.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/sessions.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/audit.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/auth-features.tsx`
- Create: `auth-core-console/src/routes/_authenticated/platform/account.tsx`
- Modify: `auth-core-console/src/components/layout/Header.tsx`
- Modify: `auth-core-console/src/components/layout/AppSidebar.tsx`
- Modify: `auth-core-console/src/routes/_authenticated.tsx`
- Modify: `auth-core-console/scripts/routes.test.mjs`

**Interfaces:**

- Consumes: `platformNav`, `filterNav`, `canPlatform`, `isPlatformActor`, `GET /api/admin/me/permissions`
- Produces:
  - `fetchActorPermissions(): Promise<{ roles: ActorRoleGrant[] }>`
  - `PlatformShell` membaca `Route.useRouteContext()` bertipe `{ roles: ActorRoleGrant[] }`
  - `UnauthorizedState` dengan prop `homeHref: string`

- [ ] **Step 1: Extend the route file test**

Di `scripts/routes.test.mjs`, wajibkan file ini ada:

```javascript
const platformRoutes = [
  "src/routes/_authenticated/platform/route.tsx",
  "src/routes/_authenticated/platform/index.tsx",
  "src/routes/_authenticated/platform/tenants.tsx",
  "src/routes/_authenticated/platform/tiers.tsx",
  "src/routes/_authenticated/platform/billing.tsx",
  "src/routes/_authenticated/platform/staff.tsx",
  "src/routes/_authenticated/platform/roles.tsx",
  "src/routes/_authenticated/platform/sessions.tsx",
  "src/routes/_authenticated/platform/audit.tsx",
  "src/routes/_authenticated/platform/auth-features.tsx",
  "src/routes/_authenticated/platform/account.tsx",
];
```

Dan assert `Header.tsx` tidak lagi merender `<OrganizationSwitcher`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/routes.test.mjs
```

Expected: FAIL, file platform route belum ada.

- [ ] **Step 3: Add the permissions client and shell components**

`src/api/actor-permissions.ts`:

```typescript
import { apiRequest } from "@/api/client";
import type { ActorRoleGrant } from "@/lib/console-shell";

export function fetchActorPermissions(): Promise<{ roles: ActorRoleGrant[] }> {
  return apiRequest<{ roles: ActorRoleGrant[] }>("/api/admin/me/permissions");
}
```

`ShellState.tsx` mengekspor `UnauthorizedState` dan `NotFoundState`. Keduanya menampilkan judul Bahasa Indonesia, tanpa data bisnis, plus `Link` ke `homeHref`.

`platform/route.tsx`:

```tsx
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { fetchActorPermissions } from "@/api/actor-permissions";
import { isPlatformActor } from "@/lib/console-shell";
import { useAuthStore } from "@/stores/useAuthStore";
import { PlatformShell } from "@/components/layout/PlatformShell";

export const Route = createFileRoute("/_authenticated/platform")({
  beforeLoad: async () => {
    const user = useAuthStore.getState().user;
    const actor = { role: user?.role ?? null, tenantId: user?.tenantId ?? null };
    if (!user || !isPlatformActor(actor)) {
      throw redirect({ to: "/tenants" });
    }
    const { roles } = await fetchActorPermissions();
    return { roles };
  },
  component: function PlatformRoute() {
    const { roles } = Route.useRouteContext();
    return (
      <PlatformShell roles={roles}>
        <Outlet />
      </PlatformShell>
    );
  },
});
```

`_authenticated.tsx` tetap gerbang sesi, tetapi jangan merender `AppSidebar` global. Pindahkan sidebar ke `PlatformShell` dan, pada Task 5, `TenantShell`. Header tetap di `_authenticated` hanya bila shell anak tidak menggantikannya. Pilihan yang dipakai: `_authenticated` merender `Header` tanpa `OrganizationSwitcher` dan tanpa sidebar. `PlatformShell` merender sidebar di kiri outlet.

Setiap halaman platform adalah file route setipis ini, contoh staff:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { canPlatform } from "@/lib/console-shell";
import { UsersPage } from "@/features/users/UsersPage";
import { UnauthorizedState } from "@/components/layout/ShellState";
import { Route as PlatformRoute } from "./route";

export const Route = createFileRoute("/_authenticated/platform/staff")({
  component: function StaffRoute() {
    const { roles } = PlatformRoute.useRouteContext();
    if (!canPlatform(roles, "user", "read")) {
      return <UnauthorizedState homeHref="/platform" />;
    }
    return <UsersPage />;
  },
});
```

Pasangan halaman dan izin baca:

| File | Komponen yang sudah ada | Izin baca |
| --- | --- | --- |
| `index.tsx` | `DashboardPage` | selalu |
| `tenants.tsx` | `AdminTenantsPage` | `organization:read` |
| `tiers.tsx` | `AdminFeatureTierMatrixPage` | `authConfig:configure` |
| `billing.tsx` | `AdminBillingPage` | `organization:read` |
| `staff.tsx` | `UsersPage` | `user:read` |
| `roles.tsx` | `RolesPage` | `role:read` |
| `sessions.tsx` | halaman sessions yang sekarang di `routes/_authenticated/sessions.tsx` | `session:read` |
| `audit.tsx` | halaman audit yang sekarang | `auditLog:read` |
| `auth-features.tsx` | `AuthFeaturesPage` | `authConfig:read` atau `authConfig:configure` |
| `account.tsx` | halaman account yang sekarang | selalu |

`PlatformShell` memfilter `platformNav` dengan `filterNav` dan `canPlatform`. Item Auth Features lolos bila `canPlatform(roles, "authConfig", "read") || canPlatform(roles, "authConfig", "configure")`. Jangan letakkan permission tunggal `authConfig:read` sebagai satu-satunya syarat untuk item itu: di `filterNav`, item Auth Features tidak memakai `permission`, dan `PlatformShell` menambahkannya sendiri bila salah satu izin terpenuhi. Overview dan Akun selalu ada.

`Header.tsx`: hapus import dan pemakaian `OrganizationSwitcher`. Pencarian memakai `platformNav` yang difilter dengan role dari context bila pathname diawali `/platform`. Di luar shell platform, pencarian kosong. `ROUTE_TITLES` menambah kunci `/platform`, `/platform/tenants`, `/platform/tiers`, `/platform/billing`, `/platform/staff`, `/platform/roles`, `/platform/sessions`, `/platform/audit`, `/platform/auth-features`, `/platform/account`.

`AppSidebar.tsx` tidak lagi di-mount dari `_authenticated`. Komponen boleh tetap dipakai `PlatformShell` dengan prop `items` hasil `filterNav`, bukan `menusConfig` mentah. Ubah logo link dari `/dashboard` ke `/platform` saat shell platform.

- [ ] **Step 4: Regenerate routes and run tests**

```bash
bunx vite build
node --test scripts/routes.test.mjs
bun run typecheck
```

Expected: tes route PASS. `typecheck` PASS. Commit `src/routeTree.gen.ts` bila Vite mengubahnya.

- [ ] **Step 5: Commit di auth-core-console**

```bash
git add src/api/actor-permissions.ts src/components/layout src/routes/_authenticated/platform src/routes/_authenticated.tsx src/routeTree.gen.ts scripts/routes.test.mjs
git commit -m "$(cat <<'EOF'
feat(console): add the platform shell and its routes

Platform pages now live under /platform and disappear from the sidebar when the actor lacks the matching read permission.
EOF
)"
```

---

### Task 5: Route tenant, mode dukungan, dan switcher

**Files:**

- Create: `auth-core-console/src/lib/tenant-shell.ts`
- Create: `auth-core-console/src/components/layout/TenantShell.tsx`
- Create: `auth-core-console/src/components/layout/TenantSwitcher.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/route.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/index.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/settings.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/features.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/oauth-clients.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/api-keys.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/users.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/organizations.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/billing.tsx`
- Create: `auth-core-console/src/routes/_authenticated/tenants/$tenantId/account.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/tenants/$tenantId.tsx` (hapus bila router mengizinkan `route.tsx` menggantikannya; jangan biarkan dua definisi route yang sama)
- Modify: `auth-core-console/src/api/tenant-service.ts` (tambah `adminGetTenant`)
- Modify: `auth-core-console/src/features/portal/PortalTenantDetailPage.tsx`
- Modify: `auth-core-console/scripts/routes.test.mjs`

**Interfaces:**

- Consumes: `resolveTenantMode`, `canPlatform`, `tenantNav`, `fetchActorPermissions`, `listMyTenants`, `getMyTenant`
- Produces:
  - `adminGetTenant(tenantId: string): Promise<TenantRecord>` di `src/api/tenant-service.ts`, memanggil `GET /api/admin/tenants/:id`
  - `loadTenantShell(tenantId: string): Promise<{ mode: TenantShellMode; tenant: TenantRecord | null }>`
    - `getMyTenant` 200 dan aktor bukan platform → `portalStatus: "owner"`
    - `getMyTenant` 200 dan aktor platform → abaikan status owner, pakai record itu, `portalStatus` yang masuk ke `resolveTenantMode` adalah `"forbidden"` supaya mode menjadi `support` atau `denied`
    - `getMyTenant` melempar `ApiRequestError` status 403 → panggil `adminGetTenant`. Status 200 berarti tenant ada (`portalStatus: "forbidden"`). Status 404 berarti `not_found`
    - `getMyTenant` status 404 → `not_found` tanpa memanggil operator
    - Mode akhir selalu lewat `resolveTenantMode`

- [ ] **Step 1: Write the failing file test**

Tambah di `scripts/routes.test.mjs` daftar file route anak `$tenantId/` di atas, plus assert `src/lib/tenant-shell.ts` memuat `resolveTenantMode` dan `loadTenantShell`. Assert `PortalTenantDetailPage.tsx` tidak lagi memuat `TabsTrigger`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/routes.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Split the tenant page into routes**

`loadTenantShell` di `src/lib/tenant-shell.ts` mengikuti kontrak di Interfaces. Jangan menaruh query `mode` pada URL.

`tenants/$tenantId/route.tsx` memanggil `loadTenantShell`. Context route: `{ mode, tenant }`.

- `not_found`: render `NotFoundState` dengan `homeHref` `/platform` untuk aktor platform dan `/tenants` untuk owner. Jangan render outlet.
- `denied`: render `UnauthorizedState` dengan home yang sama. Jangan memuat tabel user, oauth, atau organisasi.
- `owner` dan `support`: render `TenantShell`.

`TenantShell` menampilkan `tenantNav(tenant.id)`. Mode `support` menambah banner "Melihat sebagai operator" dengan `Link` ke `/platform/tenants`, dan nama tenant tanpa `TenantSwitcher`. Mode `owner` menampilkan `TenantSwitcher`, yang memuat `listMyTenants` dan berpindah ke `/tenants/$id` tenant yang dipilih.

Pindahkan isi tab ke halaman route tanpa mengubah form:

- `index.tsx` — header nama, status, tier, dan untuk `support` saja tombol suspend, aktifkan, serta ganti tier yang sekarang ada di `AdminTenantsPage`. Tombol itu memanggil API operator yang sama. Tampilkan hanya bila `canPlatform(roles, "organization", "update")`. Ambil `roles` dengan `fetchActorPermissions` di `beforeLoad` route ini bila `mode === "support"`.
- `settings.tsx` — JSX tab `settings` dari `PortalTenantDetailPage`.
- `features.tsx` — `PortalTenantFeaturesTab`.
- `oauth-clients.tsx` — JSX tab `oauth-clients`.
- `api-keys.tsx` — `PortalTenantApiKeysTab`.
- `users.tsx` — `PortalTenantUsersTab`.
- `organizations.tsx` — `PortalTenantOrgsTab`, dan di dalam halaman ini saja render `OrganizationSwitcher` yang sudah ada.
- `billing.tsx` — JSX tab `billing`. Jangan menambah tombol tulis.
- `account.tsx` — komponen account yang sama dengan `/platform/account`.

`PortalTenantDetailPage` setelah dipotong tidak boleh lagi mengekspor tab. File boleh dihapus bila tidak ada import tersisa.

Halaman `/tenants` (`tenants/index.tsx`) tetap `PortalTenantsPage` untuk owner. Di `beforeLoad`, bila `isPlatformActor`, `throw redirect({ to: "/platform/tenants" })`.

- [ ] **Step 4: Regenerate routes and run tests**

```bash
bunx vite build
node --test scripts/routes.test.mjs
bun test src/lib/console-shell.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit di auth-core-console**

```bash
git add src/lib/tenant-shell.ts src/components/layout/TenantShell.tsx src/components/layout/TenantSwitcher.tsx src/routes/_authenticated/tenants src/features/portal src/routeTree.gen.ts scripts/routes.test.mjs
git commit -m "$(cat <<'EOF'
feat(console): replace tenant tabs with a tenant shell

Owners get a per-tenant sidebar, and platform actors open the same URLs in read-oriented support mode.
EOF
)"
```

---

### Task 6: Rumah login dan redirect path lama

**Files:**

- Create: `auth-core-console/src/lib/console-home.ts`
- Modify: `auth-core-console/src/routes/index.tsx`
- Modify: `auth-core-console/src/routes/_auth.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/dashboard.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/users.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/roles.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/sessions.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/audit-logs.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/auth-features.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/api-keys.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/organizations.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/admin-tenants.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/admin-tiers.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/admin-billing.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/account.tsx`
- Modify: `auth-core-console/src/routes/_authenticated/platform/route.tsx` (`beforeLoad` aktor non-platform memakai `resolveAuthenticatedHome`, bukan selalu `/tenants`)
- Modify: `auth-core-console/src/stores/useAuthStore.ts` (default redirect `/dashboard` menjadi hasil `resolveAuthenticatedHome`)
- Modify: `auth-core-console/src/components/better-auth/auth/AuthView.tsx` dan form auth yang default `redirectTo = "/dashboard"`

**Interfaces:**

- Consumes: `redirectLegacyPath`, `resolveConsoleHome`, `isPlatformActor`, `listMyTenants`
- Produces: `resolveAuthenticatedHome(): Promise<string>`
  - aktor platform → `/platform` tanpa memanggil portal
  - selain itu `listMyTenants({ page: 0, pageSize: 2 })`, lalu `resolveConsoleHome`

- [ ] **Step 1: Write the failing source test**

Di `scripts/routes.test.mjs`:

```javascript
test("route lama mendelegasikan ke redirectLegacyPath", () => {
  for (const file of [
    "src/routes/_authenticated/dashboard.tsx",
    "src/routes/_authenticated/users.tsx",
    "src/routes/_authenticated/admin-tenants.tsx",
    "src/routes/_authenticated/account.tsx",
  ]) {
    const source = readUtf8(file);
    assert.match(source, /redirectLegacyPath/);
    assert.doesNotMatch(source, /<DashboardPage|<UsersPage|<AdminTenantsPage|<AccountView/);
  }
  assert.match(readUtf8("src/lib/console-home.ts"), /export async function resolveAuthenticatedHome/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/routes.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement redirects**

`console-home.ts`:

```typescript
import { listMyTenants } from "@/api/tenant-service";
import {
  isPlatformActor,
  resolveConsoleHome,
  toConsoleActor,
} from "@/lib/console-shell";
import { useAuthStore } from "@/stores/useAuthStore";

export async function resolveAuthenticatedHome(): Promise<string> {
  const actor = toConsoleActor(useAuthStore.getState().user);
  if (isPlatformActor(actor)) return "/platform";
  const page = await listMyTenants({ page: 0, pageSize: 2 });
  return resolveConsoleHome({
    actor,
    ownedTenantIds: page.items.map((tenant) => tenant.id),
  });
}
```

Setiap route lama menjadi:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { isPlatformActor, redirectLegacyPath, toConsoleActor } from "@/lib/console-shell";
import { listMyTenants } from "@/api/tenant-service";
import { useAuthStore } from "@/stores/useAuthStore";

export const Route = createFileRoute("/_authenticated/users")({
  beforeLoad: async () => {
    const actor = toConsoleActor(useAuthStore.getState().user);
    const owned = isPlatformActor(actor)
      ? []
      : (await listMyTenants({ page: 0, pageSize: 2 })).items.map((tenant) => tenant.id);
    throw redirect({
      href: redirectLegacyPath({ path: "/users", actor, ownedTenantIds: owned }),
    });
  },
});
```

Tambahkan fungsi ini di `console-shell.ts`:

```typescript
export function toConsoleActor(
  user: { role: string; tenantId?: string | null } | null,
): ConsoleActor {
  return {
    role: user?.role ?? null,
    tenantId: user?.tenantId ?? null,
  };
}
```

Jangan mendefinisikannya di `console-home.ts`. `redirectLegacyPath` tetap satu-satunya tabel tujuan. Pada `platform/route.tsx`, ganti `throw redirect({ to: "/tenants" })` menjadi `throw redirect({ href: await resolveAuthenticatedHome() })`. Path di tiap file adalah path lamanya sendiri (`/dashboard`, `/roles`, `/sessions`, `/audit-logs`, `/auth-features`, `/api-keys`, `/organizations`, `/admin-tenants`, `/admin-tiers`, `/admin-billing`, `/account`).

Saat route lama membutuhkan daftar tenant, panggil `listMyTenants` hanya bila `isPlatformActor(actor)` bernilai false:

```typescript
const owned = isPlatformActor(actor)
  ? []
  : (await listMyTenants({ page: 0, pageSize: 2 })).items.map((tenant) => tenant.id);
```

`routes/index.tsx` dan `_auth.tsx` `beforeLoad`: bila user ada, `throw redirect({ href: await resolveAuthenticatedHome() })`. Pertahankan pengecualian `/consent`, `/auth/accept-invitation`, `/t/`, dan subdomain di `_auth.tsx`.

Ganti default `redirectTo = "/dashboard"` pada form login console menjadi hasil `resolveAuthenticatedHome()` setelah sesi tersimpan. Jangan ubah form di `src/features/tenant-auth/` atau `src/routes/t/`.

Tambah `tenantId: string | null` pada `AuthSessionUser`. `getMe` sudah mengembalikan `tenantId: null`. Saat fallback session tanpa `/api/authcore/me`, set `tenantId: null`.

- [ ] **Step 4: Run tests**

```bash
bun test src/lib/console-shell.test.ts
node --test scripts/routes.test.mjs
bunx vite build
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit di auth-core-console**

```bash
git add src/lib/console-home.ts src/lib/console-shell.ts src/routes src/stores/useAuthStore.ts src/components/better-auth/auth src/routeTree.gen.ts scripts/routes.test.mjs
git commit -m "$(cat <<'EOF'
feat(console): send each account to its own shell home

Legacy console URLs now follow the signed-in actor instead of opening the old shared admin pages.
EOF
)"
```

---

### Task 7: Sembunyikan tombol di luar izin

**Files:**

- Create: `auth-core-console/src/components/layout/Can.tsx`
- Modify: `auth-core-console/src/features/admin-tenants/AdminTenantsPage.tsx`
- Modify: `auth-core-console/src/features/admin-billing/AdminBillingPage.tsx`
- Modify: `auth-core-console/src/features/admin-tiers/AdminFeatureTierMatrixPage.tsx`
- Modify: `auth-core-console/src/features/users/UsersPage.tsx`
- Modify: `auth-core-console/src/features/roles/RolesPage.tsx`
- Modify: `auth-core-console/src/features/sessions/` (tombol cabut sesi)
- Modify: `auth-core-console/src/features/audit-logs/` (tombol ekspor)
- Modify: `auth-core-console/src/features/auth-features/AuthFeaturesPage.tsx`
- Modify: halaman tenant yang punya tombol tulis (`settings`, `features`, `oauth-clients`, `api-keys`, `users`, `organizations`)
- Test: `auth-core-console/scripts/routes.test.mjs`

**Interfaces:**

- Consumes: `canPlatform`, context `roles` dari platform route, `mode` dari tenant route
- Produces:
  - `Can({ resource, action, children })` merender `children` hanya bila `canPlatform` benar
  - `OwnerOnly({ children })` merender `children` hanya bila `mode === "owner"`

- [ ] **Step 1: Write the failing source test**

```javascript
test("tombol tulis platform dan tenant memakai gerbang izin", () => {
  assert.match(readUtf8("src/components/layout/Can.tsx"), /export function Can/);
  assert.match(readUtf8("src/components/layout/Can.tsx"), /export function OwnerOnly/);
  assert.match(readUtf8("src/features/users/UsersPage.tsx"), /resource="user"/);
  assert.match(readUtf8("src/features/admin-tenants/AdminTenantsPage.tsx"), /organization/);
  assert.match(
    readUtf8("src/features/portal/PortalTenantUsersTab.tsx"),
    /OwnerOnly/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/routes.test.mjs
```

Expected: FAIL, `Can.tsx` belum ada.

- [ ] **Step 3: Gate the buttons**

`Can.tsx` membaca `roles` dari context route platform. `OwnerOnly` membaca `mode` dari context route `$tenantId`.

Bungkus tombol berikut. Jangan bungkus tombol batal, tutup dialog, atau salin secret yang hanya menampilkan data yang sudah terbuka.

| Lokasi | Tombol | Gerbang |
| --- | --- | --- |
| `AdminTenantsPage` | buat tenant | `Can resource="organization" action="create"` |
| `AdminTenantsPage` dan ringkasan tenant | suspend, aktifkan, ganti tier | `Can resource="organization" action="update"` |
| `AdminBillingPage` | catat entri | `Can resource="organization" action="update"` |
| `AdminFeatureTierMatrixPage` | simpan matriks, ubah status fitur | `Can resource="authConfig" action="configure"` |
| `UsersPage` | buat, ubah, hapus, ban, impersonate | `Can resource="user"` dengan aksi masing-masing |
| `RolesPage` | buat, simpan matriks, hapus | `Can resource="role"` dengan `create`, `update`, `delete` |
| `SessionsPage` | cabut sesi | `Can resource="session" action="revoke"` |
| `AuditLogsPage` | tidak ada tombol ekspor hari ini. Tombol `Refresh Stream` tetap tampil untuk siapa pun yang sudah lolos izin baca halaman | jangan menambah fitur ekspor |
| `AuthFeaturesPage` | ubah plugin | `Can resource="authConfig" action="configure"` |
| Tab tenant settings, features, oauth, api keys, users, organizations | setiap tombol yang membuat, mengubah, atau menghapus | `OwnerOnly` |

`PortalTenantUsersTab` tidak menampilkan impersonate. `billing.tsx` tidak dibungkus `OwnerOnly` karena tidak ada tombol tulis.

- [ ] **Step 4: Run tests**

```bash
node --test scripts/routes.test.mjs
bun test src/lib/console-shell.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit di auth-core-console**

```bash
git add src/components/layout/Can.tsx src/features scripts/routes.test.mjs
git commit -m "$(cat <<'EOF'
feat(console): hide actions the current actor cannot perform

Platform buttons follow auth_core_role, and tenant write actions stay with the owner while support mode remains read-only.
EOF
)"
```

---

### Task 8: Verifikasi perjalanan di browser

**Files:**

- Modify: hanya file yang gagal pada perjalanan di bawah. Jangan membuat commit kosong.

**Interfaces:**

- Consumes: seluruh route dan gerbang dari Task 4–7.

- [ ] **Step 1: Start the console against the API**

Console sudah memakai `bun run dev` pada port 2000 bila terminal itu masih hidup. API harus menyala dengan data operator dan minimal satu tenant milik akun `user`.

- [ ] **Step 2: Walk the four journeys**

1. Login `super_admin`. URL menjadi `/platform`. Sidebar tidak berisi Organizations, API Keys, atau OAuth. Header tidak berisi switcher organisasi. Buka satu tenant dari direktori. Banner dukungan tampil. Tombol tulis tenant tidak tampil. Suspend, aktifkan, dan ganti tier tampil. Kembali ke `/platform/tenants` lewat banner.
2. Login `support_agent`. Sidebar hanya memuat menu yang izinnya ada (`user:read`, `session:read`, `organization:read`, `auditLog:read`) plus Overview dan Akun. Buka tenant. Tidak ada tombol tulis dan tidak ada suspend.
3. Login owner yang hanya punya satu tenant. URL menjadi `/tenants/:tenantId`. Sidebar adalah sembilan menu tenant. Buka `/platform`. Kembali ke shell tenant itu. Matikan satu fitur lewat tier atau IAM sampai `FeatureDisabledCard` tampil, sementara item menunya tetap ada.
4. Dari akun owner satu tenant, buka `/users`. Mendarat di `/tenants/:id/users`. Dari `super_admin`, buka `/users`. Mendarat di `/platform/staff`.

- [ ] **Step 3: Fix any broken journey and commit only those fixes**

Ulangi perjalanan yang gagal. Commit di repo yang berubah, dengan pesan yang menyebut perjalanan yang diperbaiki.

- [ ] **Step 4: Run the final checks**

Di `auth-core-api`:

```bash
bun test src/modules/platform-console/services/platform-actor-permissions.service.spec.ts src/modules/platform-console/controllers/actor-permissions.controller.spec.ts
```

Di `auth-core-console`:

```bash
bun run test:routes
bun run typecheck
```

Expected: PASS.
