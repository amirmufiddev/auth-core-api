# Integritas Batas Tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memisahkan kunci cache tenant dan organization, menolak otorisasi platform yang hanya mengandalkan `user.role`, dan mengunci `tenant_id` anak agar sama dengan user atau organization lewat `tenant_scope` plus composite FK, sambil membuat hard-delete tenant gagal.

**Architecture:** `RlsContext` hanya menyimpan `{ tenantId, organizationId }`. Cache membangun prefix `tenant:`, `platform:`, atau `org:` dari accessor yang sesuai. Guard platform memuat baris `user` sebelum membaca role. Plugin isolasi Better Auth menolak `/admin` dan tulisan adapter yang lintas tenant. PostgreSQL menghitung `tenant_scope = coalesce(tenant_id, '')` dan menolak pasangan yang tidak cocok; FK ke `tenant.id` pada tabel operasional menjadi `ON DELETE RESTRICT`.

**Tech Stack:** NestJS 11, Drizzle ORM 0.45, drizzle-kit 0.31, PostgreSQL, Better Auth, bun test.

## Global Constraints

- `user.tenant_id NULL` = akun platform. `NOT NULL` = user pool tenant. Jangan mengganti sentinel ini dengan id tenant palsu.
- `organization` tetap workspace di dalam satu tenant. `organization.tenant_id` tetap `NOT NULL`.
- Jangan menambah `CHECK` yang melarang `user.role = 'admin'` pada user tenant.
- Jangan menambah endpoint purge tenant dan jangan mengubah `TenantService` yang sudah men-set `status: 'suspended'`.
- Jangan mengubah kunci `PermissionScopeCacheService`.
- Jangan mengaktifkan `ENABLE ROW LEVEL SECURITY`.
- Jangan menulis `tenant_scope` dari aplikasi atau `additionalFields` Better Auth. PostgreSQL yang menghitungnya.
- `invitation.inviter_id` tidak ikut composite FK ke `user`.
- `oauth_client.user_id` tidak ikut composite FK ke `user`. Tabel itu hanya mendapat `tenant_scope`, check, dan `ON DELETE RESTRICT` pada `tenant_id`.
- `audit_trail_logs.tenant_id` tetap `ON DELETE SET NULL`.
- File SQL hasil `drizzle-kit generate` tidak diedit manual. Perbaikan schema dilakukan di TypeScript, lalu generate ulang.
- Migrasi tidak memperbaiki baris yang sudah menyimpang. Jika preflight menemukan baris, berhenti.
- Perintah dijalankan dari `auth-core-api/`.

---

### Task 1: `RlsContext` hanya objek

**Files:**

- Modify: `src/shared/database/rls-context.ts`
- Test: `src/shared/database/rls-context.spec.ts`

**Interfaces:**

- Consumes: tidak ada.
- Produces: `RlsStore`, `RlsContext.run(ctx: RlsStore, fn)`, `RlsContext.hasStore(): boolean`, `RlsContext.getCurrentTenantId(): string | null`, `RlsContext.getCurrentOrganizationId(): string | null`.

- [ ] **Step 1: Ganti tes yang masih memanggil `run` dengan string**

Tulis ulang `src/shared/database/rls-context.spec.ts`:

```ts
import { RlsContext } from './rls-context';

describe('RlsContext', () => {
  it('should report no store outside run()', () => {
    expect(RlsContext.hasStore()).toBe(false);
    expect(RlsContext.getCurrentTenantId()).toBeNull();
    expect(RlsContext.getCurrentOrganizationId()).toBeNull();
  });

  it('should keep a platform store distinct from a missing store', () => {
    RlsContext.run({ tenantId: null, organizationId: null }, () => {
      expect(RlsContext.hasStore()).toBe(true);
      expect(RlsContext.getCurrentTenantId()).toBeNull();
      expect(RlsContext.getCurrentOrganizationId()).toBeNull();
    });
    expect(RlsContext.hasStore()).toBe(false);
  });

  it('should return both ids inside run()', () => {
    RlsContext.run(
      { tenantId: 'ten_1', organizationId: 'org_1' },
      () => {
        expect(RlsContext.getCurrentTenantId()).toBe('ten_1');
        expect(RlsContext.getCurrentOrganizationId()).toBe('org_1');
      },
    );
  });

  it('should restore the outer store after a nested run()', () => {
    RlsContext.run({ tenantId: 'ten_outer', organizationId: 'org_outer' }, () => {
      RlsContext.run(
        { tenantId: null, organizationId: 'org_inner' },
        () => {
          expect(RlsContext.getCurrentTenantId()).toBeNull();
          expect(RlsContext.getCurrentOrganizationId()).toBe('org_inner');
        },
      );
      expect(RlsContext.getCurrentTenantId()).toBe('ten_outer');
      expect(RlsContext.getCurrentOrganizationId()).toBe('org_outer');
    });
  });
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `bun test src/shared/database/rls-context.spec.ts`

Expected: FAIL karena `hasStore` belum ada dan `run('org-123')` tidak lagi cocok dengan tes baru. Tes baru memanggil `hasStore` sebelum implementasi.

- [ ] **Step 3: Implementasi**

Ganti isi `src/shared/database/rls-context.ts` dengan:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RlsStore {
  tenantId: string | null;
  organizationId: string | null;
}

const storage = new AsyncLocalStorage<RlsStore>();

export class RlsContext {
  static run<T>(ctx: RlsStore, fn: () => T): T {
    const store: RlsStore = {
      tenantId: ctx.tenantId ?? null,
      organizationId: ctx.organizationId ?? null,
    };
    return storage.run(store, fn);
  }

  static hasStore(): boolean {
    return storage.getStore() !== undefined;
  }

  static getCurrentTenantId(): string | null {
    const store = storage.getStore();
    return store?.tenantId ?? null;
  }

  static getCurrentOrganizationId(): string | null {
    const store = storage.getStore();
    return store?.organizationId ?? null;
  }
}
```

`src/shared/database/rls.interceptor.ts` sudah memanggil `RlsContext.run({ tenantId, organizationId }, ...)`. Jangan diubah.

- [ ] **Step 4: Jalankan tes dan pastikan lulus**

Run: `bun test src/shared/database/rls-context.spec.ts`

Expected: PASS, 4 tes.

- [ ] **Step 5: Commit**

```bash
git add src/shared/database/rls-context.ts src/shared/database/rls-context.spec.ts
git commit -m "$(cat <<'EOF'
feat(rls): require an explicit tenant and organization store

EOF
)"
```

---

### Task 2: Kunci cache tenant dan organization

**Files:**

- Create: `src/common/cache/cache-scope.error.ts`
- Modify: `src/common/cache/cache.service.ts`
- Test: `src/common/cache/cache.service.spec.ts`

**Interfaces:**

- Consumes: `RlsContext.hasStore`, `getCurrentTenantId`, `getCurrentOrganizationId` dari Task 1.
- Produces: `CacheScopeMissingError`, `CacheService.buildTenantKey`, `buildOrganizationKey`, `setTenantScoped(tenantId: string | null, ...)`, `setOrganizationScoped(organizationId: string, ...)`. `buildKey` dan `setScoped` dihapus.

- [ ] **Step 1: Ganti blok `buildKey` dan `setScoped` di spec**

Hapus `describe('buildKey')` dan `describe('setScoped')` di `src/common/cache/cache.service.spec.ts`. Tambahkan:

```ts
describe('buildTenantKey', () => {
  it('should prefix a tenant id from the current store', () => {
    jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
    jest.spyOn(RlsContext, 'getCurrentTenantId').mockReturnValue('ten_123');
    expect(service.buildTenantKey('user:role:abc', 'app')).toBe(
      'app:tenant:ten_123:user:role:abc',
    );
  });

  it('should use the platform prefix when the store has a null tenant', () => {
    jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
    jest.spyOn(RlsContext, 'getCurrentTenantId').mockReturnValue(null);
    expect(service.buildTenantKey('user:role:abc', 'app')).toBe(
      'app:platform:user:role:abc',
    );
  });

  it('should throw when no store is active', () => {
    jest.spyOn(RlsContext, 'hasStore').mockReturnValue(false);
    expect(() => service.buildTenantKey('user:role:abc', 'app')).toThrow(
      'CacheScopeMissingError',
    );
  });
});

describe('buildOrganizationKey', () => {
  it('should prefix the current organization id', () => {
    jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
    jest
      .spyOn(RlsContext, 'getCurrentOrganizationId')
      .mockReturnValue('org_9');
    expect(service.buildOrganizationKey('member:abc', 'app')).toBe(
      'app:org:org_9:member:abc',
    );
  });

  it('should throw when the store has no organization', () => {
    jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
    jest.spyOn(RlsContext, 'getCurrentOrganizationId').mockReturnValue(null);
    expect(() => service.buildOrganizationKey('member:abc', 'app')).toThrow(
      'CacheScopeMissingError',
    );
  });
});

describe('setTenantScoped', () => {
  it('should write a platform key when tenantId is null', async () => {
    mockCacheManager.set.mockResolvedValueOnce(undefined);
    await service.setTenantScoped(null, 'user:role:xyz', 'val', 'app', 3000);
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'app:platform:user:role:xyz',
      'val',
      3000,
    );
  });

  it('should write a tenant key when tenantId is set', async () => {
    mockCacheManager.set.mockResolvedValueOnce(undefined);
    await service.setTenantScoped('ten_999', 'user:role:xyz', 'val', 'app', 3000);
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'app:tenant:ten_999:user:role:xyz',
      'val',
      3000,
    );
  });
});

describe('setOrganizationScoped', () => {
  it('should write an organization key', async () => {
    mockCacheManager.set.mockResolvedValueOnce(undefined);
    await service.setOrganizationScoped('org_3', 'member:xyz', 'val', 'app', 3000);
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'app:org:org_3:member:xyz',
      'val',
      3000,
    );
  });
});
```

Impor `CacheScopeMissingError` tidak diperlukan: tes memakai pesan nama kelas. Implementasi melempar error yang `name`-nya `CacheScopeMissingError`, dan `toThrow('CacheScopeMissingError')` cocok dengan `error.message` yang sama.

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `bun test src/common/cache/cache.service.spec.ts`

Expected: FAIL karena `buildTenantKey` belum ada.

- [ ] **Step 3: Tambah error dan method**

Buat `src/common/cache/cache-scope.error.ts`:

```ts
export class CacheScopeMissingError extends Error {
  constructor(scope: 'tenant' | 'organization') {
    super('CacheScopeMissingError');
    this.name = 'CacheScopeMissingError';
    this.scope = scope;
  }

  readonly scope: 'tenant' | 'organization';
}
```

Di `cache.service.ts`, impor error itu. Hapus `buildKey` dan `setScoped`. Tambahkan:

```ts
buildTenantKey(key: string, globalPrefix: string): string {
  if (!RlsContext.hasStore()) {
    throw new CacheScopeMissingError('tenant');
  }
  const tenantId = RlsContext.getCurrentTenantId();
  return tenantId
    ? `${globalPrefix}:tenant:${tenantId}:${key}`
    : `${globalPrefix}:platform:${key}`;
}

buildOrganizationKey(key: string, globalPrefix: string): string {
  if (!RlsContext.hasStore()) {
    throw new CacheScopeMissingError('organization');
  }
  const organizationId = RlsContext.getCurrentOrganizationId();
  if (!organizationId) {
    throw new CacheScopeMissingError('organization');
  }
  return `${globalPrefix}:org:${organizationId}:${key}`;
}

async setTenantScoped<T>(
  tenantId: string | null,
  key: string,
  value: T,
  globalPrefix: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const scope = tenantId
    ? `${globalPrefix}:tenant:${tenantId}:${key}`
    : `${globalPrefix}:platform:${key}`;
  await this.set(scope, value, ttlMs);
}

async setOrganizationScoped<T>(
  organizationId: string,
  key: string,
  value: T,
  globalPrefix: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  await this.set(
    `${globalPrefix}:org:${organizationId}:${key}`,
    value,
    ttlMs,
  );
}
```

- [ ] **Step 4: Jalankan tes dan pastikan lulus**

Run: `bun test src/common/cache/cache.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/common/cache/cache-scope.error.ts src/common/cache/cache.service.ts src/common/cache/cache.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(cache): split tenant and organization cache keys

EOF
)"
```

---

### Task 3: Dokumen pemanggilan `RlsContext.run`

**Files:**

- Modify: `src/shared/README.md`
- Modify: `docs/database.md`
- Modify: `docs/testing.md`
- Modify: `docs/security-guidelines.md`
- Modify: `docs/anti-patterns-reference.md`
- Modify: `docs/auth.md`

**Interfaces:**

- Consumes: signature `RlsContext.run` dari Task 1.
- Produces: contoh dokumen yang memakai objek `{ tenantId, organizationId }`.

- [ ] **Step 1: Ganti contoh string menjadi objek**

`src/shared/README.md` pada contoh manual run:

```ts
const result = RlsContext.run(
  { tenantId: 'ten_123', organizationId: 'org_123' },
  () => {
    return this.orderService.processOrder('o-456');
  },
);
```

Di paragraf pembuka bagian RLS, sebut `tenantId` dan `organizationId`, bukan hanya `organizationId`.

`docs/database.md` ganti bullet dan contoh:

```ts
await RlsContext.run(
  { tenantId: 'ten_123', organizationId: 'org_123' },
  async () => {
    await orderService.rebuildDailySummary();
  },
);
```

Bullet pemakaian menjadi: background job dan test memanggil `RlsContext.run({ tenantId, organizationId }, callback)`.

`docs/testing.md` ganti `RlsContext.run('organization-42', ...)` menjadi `RlsContext.run({ tenantId: null, organizationId: 'organization-42' }, ...)`.

`docs/security-guidelines.md` ganti `RlsContext.run(org.id, () => ...)` menjadi `RlsContext.run({ tenantId: org.tenantId, organizationId: org.id }, () => ...)`.

`docs/anti-patterns-reference.md` ganti `RlsContext.run(organization.id, () => ...)` dengan objek yang sama.

`docs/auth.md` pada bagian Multi-Tenancy, ganti diagram teks menjadi:

```text
Better Auth session
        ↓
RlsInterceptor
        ↓
RlsContext { tenantId, organizationId }
        ↓
cache tenant memakai tenantId
cache organization memakai organizationId
```

- [ ] **Step 2: Pastikan tidak ada pemanggilan string yang tersisa**

Run: `rg "RlsContext\\.run\\((['\\\"]|[A-Za-z0-9_\\.]+)," src docs`

Expected: tidak ada baris. Pemanggilan yang lolos hanya yang kurung bukanya diikuti `{`.

- [ ] **Step 3: Commit**

```bash
git add src/shared/README.md docs/database.md docs/testing.md docs/security-guidelines.md docs/anti-patterns-reference.md docs/auth.md
git commit -m "$(cat <<'EOF'
docs(rls): show tenant and organization on RlsContext.run

EOF
)"
```

---

### Task 4: Guard platform membaca baris user

**Files:**

- Create: `src/modules/rbac/services/platform-account.ts`
- Modify: `src/modules/rbac/guards/platform-permission.guard.ts`
- Modify: `src/modules/customer-portal/guards/tenant-owner.guard.ts`
- Test: `src/modules/rbac/guards/platform-permission.guard.spec.ts`
- Test: `src/modules/customer-portal/services/customer-portal.service.spec.ts`

**Interfaces:**

- Consumes: `schema.user`.
- Produces:

```ts
assertPlatformAccount(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  deniedMessage: string,
): Promise<{ id: string; role: string | null; tenantId: null }>
```

- [ ] **Step 1: Tambah tes penolakan klaim `tenantId: null`**

Di `platform-permission.guard.spec.ts`, tambah tes ini. Mock harus menghitung tabel yang di-query:

```ts
it('should reject a session that claims tenantId null when the user row is a tenant admin', async () => {
  class DummyController {
    @RequirePlatformPermission('auditLog:read')
    listAuditLogs() {}
  }

  const queried: unknown[] = [];
  const db = {
    select: mock(() => ({
      from: mock((table: unknown) => {
        queried.push(table);
        const rows =
          table === schema.user
            ? [{ tenantId: 'ten_acme', role: 'admin' }]
            : [{ slug: 'admin', permissions: { auditLog: ['read'] } }];
        return {
          where: mock(() => ({
            limit: mock(() => Promise.resolve(rows.slice(0, 1))),
            then: (resolve: (value: typeof rows) => unknown) =>
              Promise.resolve(rows).then(resolve),
          })),
        };
      }),
    })),
  } as any;

  const guard = new PlatformPermissionGuard(new Reflector(), db);
  const ctx = createExecutionContext(DummyController.prototype.listAuditLogs, {
    user: {
      id: 'usr_tenant_admin',
      role: 'admin',
      tenantId: null,
    },
  });

  await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  expect(queried).toContain(schema.user);
  expect(queried).not.toContain(schema.authCoreRole);
});
```

Di `customer-portal.service.spec.ts`, di dalam `describe('TenantOwnerGuard')`, tambah:

```ts
it('should reject when the session claims tenantId null but the user row is a tenant user', async () => {
  const tenantService = {
    getTenantById: mock(() => Promise.resolve(makeTenantRow())),
  } as any;
  const guard = new TenantOwnerGuard(
    tenantService,
    createDbMock([{ tenantId: 'ten_1', role: 'admin' }]),
  );

  await expect(
    guard.canActivate(
      createExecutionContext(
        { user: { id: 'usr_owner', tenantId: null, role: 'admin' } },
        { tenantId: 'ten_1' },
      ),
    ),
  ).rejects.toThrow(ForbiddenException);
  expect(tenantService.getTenantById).not.toHaveBeenCalled();
});
```

Tes platform yang hari ini memakai `makeSimpleDbMock` sambil mengirim `tenantId: null` harus pindah ke `makeTableAwareDbMock`, karena guard sekarang selalu membaca `user` lebih dulu. Untuk tiap tes di bawah, `userRows` membawa role yang sama dengan klaim sesi dan `roleRows` memakai array yang tadi diberikan ke `makeSimpleDbMock`:

| Tes | `userRows` | `roleRows` |
| --- | --- | --- |
| allow auditor `auditLog:read` | `[{ tenantId: null, role: 'auditor' }]` | satu baris auditor dengan `auditLog: ['read', 'export']` |
| reject auditor `user:delete` | `[{ tenantId: null, role: 'auditor' }]` | baris auditor yang sama |
| role null | `[{ tenantId: null, role: null }]` | `[]` |
| role `unknown_role` | `[{ tenantId: null, role: 'unknown_role' }]` | `[]` |
| comma-separated roles | `[{ tenantId: null, role: 'user, auditor' }]` | `user` permissions `{}` dan `auditor` dengan `auditLog: ['read', 'export']` |
| `tenantId` undefined dan DB null | `[{ tenantId: null, role: 'auditor' }]` | baris auditor yang sudah ada |

Tes "reject tenant users (`tenantId !== null`)" tetap memakai mock sederhana dan tetap mengharapkan `db.select` tidak dipanggil.

- [ ] **Step 2: Jalankan tes dan pastikan tes baru gagal**

Run: `bun test src/modules/rbac/guards/platform-permission.guard.spec.ts src/modules/customer-portal/services/customer-portal.service.spec.ts`

Expected: tes klaim `tenantId: null` FAIL karena guard belum membaca database pada jalur itu.

- [ ] **Step 3: Helper dan kedua guard**

Buat `src/modules/rbac/services/platform-account.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/database/schema';

export async function assertPlatformAccount(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  deniedMessage: string,
): Promise<{ id: string; role: string | null; tenantId: null }> {
  const [row] = await db
    .select({
      id: schema.user.id,
      role: schema.user.role,
      tenantId: schema.user.tenantId,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!row || row.tenantId !== null) {
    throw new ForbiddenException(deniedMessage);
  }

  return { id: row.id, role: row.role, tenantId: null };
}
```

Di `PlatformPermissionGuard.canActivate`, setelah cek `user` ada:

```ts
if (!user.id) {
  throw new UnauthorizedException('Sesi login diperlukan.');
}

if (typeof user.tenantId === 'string' && user.tenantId.length > 0) {
  throw new ForbiddenException(
    'Hanya akun platform yang dapat mengakses fitur ini.',
  );
}

const platformUser = await assertPlatformAccount(
  this.db,
  user.id,
  'Hanya akun platform yang dapat mengakses fitur ini.',
);

const roleSlugs = (platformUser.role ?? '')
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean);
```

Hapus cabang lama yang hanya query database ketika `tenantId === undefined`, dan hapus pembacaan `user.role` dari sesi.

Di `TenantOwnerGuard`, pola yang sama dengan pesan `'Hanya akun platform yang dapat mengakses portal pelanggan.'`. Setelah `assertPlatformAccount` lulus, lanjut ke cek `params.tenantId` dan `ownerUserId` yang sudah ada. Jangan membaca `user.role` untuk keputusan portal.

- [ ] **Step 4: Jalankan tes dan pastikan lulus**

Run: `bun test src/modules/rbac/guards/platform-permission.guard.spec.ts src/modules/customer-portal/services/customer-portal.service.spec.ts`

Expected: PASS, termasuk tes lama yang mock-nya sudah memuat `role` pada baris user.

- [ ] **Step 5: Commit**

```bash
git add src/modules/rbac/services/platform-account.ts src/modules/rbac/guards/platform-permission.guard.ts src/modules/rbac/guards/platform-permission.guard.spec.ts src/modules/customer-portal/guards/tenant-owner.guard.ts src/modules/customer-portal/services/customer-portal.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(rbac): confirm platform accounts from the user row

EOF
)"
```

---

### Task 5: Label audit tidak memakai fallback admin

**Files:**

- Modify: `src/modules/platform-console/controllers/auth-config.controller.ts`

**Interfaces:**

- Consumes: tidak ada.
- Produces: `actor.role` pada audit `config.features_updated` memakai `session.user.role ?? 'user'`.

- [ ] **Step 1: Ganti fallback**

Di `updateConfig`, ubah satu field:

```ts
role: session.user.role ?? 'user',
```

Otorisasi method tetap `@RequirePlatformPermission('authFeature:configure')`.

- [ ] **Step 2: Commit**

```bash
git add src/modules/platform-console/controllers/auth-config.controller.ts
git commit -m "$(cat <<'EOF'
fix(audit): stop labeling a missing role as admin

EOF
)"
```

---

### Task 6: Middleware `/admin`

**Files:**

- Modify: `src/modules/auth/multi-tenant/tenant-auth-hooks.ts`
- Test: `src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

**Interfaces:**

- Consumes: `getEffectiveTenantContext`, `getSessionFromCtx`, `unscopedAdapter.findOne`, `buildTenantIsolationPlugin`.
- Produces: konstanta `CROSS_TENANT_ADMIN_ERROR = 'CROSS_TENANT_ADMIN'`. Middleware `before` yang matcher-nya benar hanya untuk path `/admin` dan `/admin/*`.

- [ ] **Step 1: Tulis tes matcher dan tiga aktor**

Di `tenant-auth-hooks.spec.ts`:

```ts
import { APIError } from 'better-auth';
import { CROSS_TENANT_ADMIN_ERROR } from './tenant-auth-hooks';

function platformStore(): ResolvedTenantContext {
  return {
    tenantId: null,
    slug: '',
    tierId: null,
    configVersion: 1,
    source: 'path',
  };
}

function tenantStore(tenantId: string): ResolvedTenantContext {
  return {
    tenantId,
    slug: 'pos-amir',
    tierId: 'tier_business',
    configVersion: 1,
    source: 'path',
  };
}

async function expectApiCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `expected ${code}`) {
      throw error;
    }
    expect(JSON.stringify(error)).toContain(code);
  }
}

function adminHook(staticTenantContext: ResolvedTenantContext, user: { id: string; tenantId: string | null } | null) {
  const plugin = buildTenantIsolationPlugin({
    staticTenantContext,
    enabledPlugins: {
      twoFactor: false,
      passkey: false,
      apiKey: false,
      deviceAuthorization: false,
      oauthProvider: false,
    },
  });
  plugin.init({
    adapter: {
      findOne: async () => user,
    },
  });
  const hook = plugin.hooks.before.find(
    (entry: { matcher: (ctx: { path?: string }) => boolean }) =>
      entry.matcher({ path: '/admin/list-users' }) &&
      !entry.matcher({ path: '/sign-in/email' }),
  );
  if (!hook) throw new Error('admin hook missing');
  return hook;
}

it('should reject a tenant admin on the platform auth instance', async () => {
  const hook = adminHook(platformStore(), { id: 'usr_t', tenantId: 'ten_a' });
  await expectApiCode(
    hook.handler({
      path: '/admin/list-users',
      context: { session: { user: { id: 'usr_t' } } },
      headers: new Headers(),
    }),
    CROSS_TENANT_ADMIN_ERROR,
  );
});

it('should reject a platform admin on a tenant auth instance', async () => {
  const hook = adminHook(tenantStore('ten_a'), { id: 'usr_p', tenantId: null });
  await expectApiCode(
    hook.handler({
      path: '/admin/ban-user',
      context: { session: { user: { id: 'usr_p' } } },
      headers: new Headers(),
    }),
    CROSS_TENANT_ADMIN_ERROR,
  );
});

it('should allow a tenant admin on that tenant auth instance', async () => {
  const hook = adminHook(tenantStore('ten_a'), { id: 'usr_t', tenantId: 'ten_a' });
  await expect(
    hook.handler({
      path: '/admin/list-users',
      context: { session: { user: { id: 'usr_t' } } },
      headers: new Headers(),
    }),
  ).resolves.toBeUndefined();
});
```

Sesuaikan impor `ResolvedTenantContext` dan `buildTenantIsolationPlugin` dengan impor yang sudah ada di file spec. Jika `APIError` tidak punya `body.code` pada assertion, tangkap error dan assert `error instanceof APIError` plus `String(error).includes(CROSS_TENANT_ADMIN_ERROR)` atau field `error.body.code` yang benar-benar dilempar `new APIError('FORBIDDEN', { code })`. Jangan mengganti kode error.

`getSessionFromCtx` di tes ini tidak punya request Better Auth yang utuh. Middleware harus membaca `ctx.context.session.user.id` lebih dulu, dan hanya memanggil `getSessionFromCtx` bila session context kosong. Tes di atas mengisi `ctx.context.session`.

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `bun test src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

Expected: FAIL pada tiga tes baru karena hook `/admin` belum ada.

- [ ] **Step 3: Tambah hook**

Di `tenant-auth-hooks.ts`, ekspor:

```ts
export const CROSS_TENANT_ADMIN_ERROR = 'CROSS_TENANT_ADMIN';
```

Di array `hooks.before` milik `buildTenantIsolationPlugin`, tambah entry terakhir:

```ts
{
  matcher: (ctx: { path?: string }) =>
    ctx.path === '/admin' || Boolean(ctx.path?.startsWith('/admin/')),
  handler: createAuthMiddleware(async (ctx) => {
    const contextSession = ctx.context?.session as
      | { user?: { id?: string } }
      | undefined;
    const userId = contextSession?.user?.id;
    if (!userId) {
      return;
    }
    if (!unscopedAdapter.findOne) {
      throw new APIError('FORBIDDEN', {
        code: CROSS_TENANT_ADMIN_ERROR,
        message: 'Aksi admin hanya sah di dalam tenant akun ini.',
      });
    }
    const row = (await unscopedAdapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: userId, operator: 'eq' }],
    })) as { tenantId?: string | null } | null;
    const actorTenantId = row?.tenantId ?? null;
    const requestTenantId = getEffectiveTenantContext(
      options.staticTenantContext,
      ctx.context,
    ).tenantId;
    if (!row || actorTenantId !== requestTenantId) {
      throw new APIError('FORBIDDEN', {
        code: CROSS_TENANT_ADMIN_ERROR,
        message: 'Aksi admin hanya sah di dalam tenant akun ini.',
      });
    }
  }),
},
```

`plugin.init` sudah mengisi `unscopedAdapter` sebelum request. Tes memanggil `init` langsung.

- [ ] **Step 4: Jalankan tes dan pastikan lulus**

Run: `bun test src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

Expected: PASS, termasuk tes isolasi yang sudah ada.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/multi-tenant/tenant-auth-hooks.ts src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts
git commit -m "$(cat <<'EOF'
fix(auth): reject admin plugin calls that cross tenant context

EOF
)"
```

---

### Task 7: Helper schema, `user`, `organization`, dan `tenant`

**Files:**

- Create: `src/database/schema/tenant-scope.ts`
- Modify: `src/database/schema/tenant.ts`
- Modify: `src/database/schema/better-auth-user.ts`
- Modify: `src/database/schema/better-auth-organization.ts`

**Interfaces:**

- Consumes: tidak ada.
- Produces: `tenantScopeColumn()`, `tenantIdNotBlank(name, column)`, `userTenantScopeFk(...)`, `organizationTenantScopeFk(...)`. `user.tenantScope`, `organization.tenantScope`, unique `uq_user_id_tenant_scope`, unique `uq_organization_id_tenant_scope`.

- [ ] **Step 1: Helper**

Buat `src/database/schema/tenant-scope.ts`:

```ts
import { sql, type SQLWrapper } from 'drizzle-orm';
import { check, foreignKey, text } from 'drizzle-orm/pg-core';

export function tenantScopeColumn() {
  return text('tenant_scope')
    .generatedAlwaysAs(sql`coalesce(tenant_id, '')`, { mode: 'stored' })
    .notNull();
}

export function tenantIdNotBlank(name: string, tenantId: SQLWrapper) {
  return check(name, sql`${tenantId} IS NULL OR ${tenantId} <> ''`);
}

export function userTenantScopeFk(
  name: string,
  userId: SQLWrapper,
  tenantScope: SQLWrapper,
  userIdTarget: SQLWrapper,
  userScopeTarget: SQLWrapper,
) {
  return foreignKey({
    name,
    columns: [userId, tenantScope],
    foreignColumns: [userIdTarget, userScopeTarget],
  }).onDelete('cascade');
}

export function organizationTenantScopeFk(
  name: string,
  organizationId: SQLWrapper,
  tenantScope: SQLWrapper,
  organizationIdTarget: SQLWrapper,
  organizationScopeTarget: SQLWrapper,
) {
  return foreignKey({
    name,
    columns: [organizationId, tenantScope],
    foreignColumns: [organizationIdTarget, organizationScopeTarget],
  }).onDelete('cascade');
}
```

Jika tipe kolom Drizzle menolak `SQLWrapper` pada `foreignKey.columns`, ganti parameter itu ke `AnyColumn` dari `drizzle-orm` tanpa mengubah nama fungsi atau nama constraint.

- [ ] **Step 2: `tenant.id` tidak boleh string kosong**

Di callback ketiga `tenant`:

```ts
check('ck_tenant_id_not_blank', sql`${table.id} <> ''`),
```

- [ ] **Step 3: `user`**

Pada kolom, setelah `tenantId`:

```ts
tenantScope: tenantScopeColumn(),
```

Ubah FK `tenantId` dari `onDelete: 'cascade'` menjadi `onDelete: 'restrict'`.

Di callback indeks, tambah:

```ts
uniqueIndex('uq_user_id_tenant_scope').on(table.id, table.tenantScope),
tenantIdNotBlank('ck_user_tenant_id_not_blank', table.tenantId),
```

- [ ] **Step 4: `organization` dan `organization_role`**

Pada `organization`, setelah `tenantId`:

```ts
tenantScope: tenantScopeColumn(),
```

Ubah FK `tenant.id` menjadi `onDelete: 'restrict'`.

Di callback:

```ts
uniqueIndex('uq_organization_id_tenant_scope').on(table.id, table.tenantScope),
tenantIdNotBlank('ck_organization_tenant_id_not_blank', table.tenantId),
```

Pada `organizationRole`, setelah `tenantId`:

```ts
tenantScope: tenantScopeColumn(),
```

Ubah FK `tenant.id` menjadi `onDelete: 'restrict'`. FK `organization.id` tetap `cascade`.

Di callback `organizationRole`:

```ts
tenantIdNotBlank('ck_organization_role_tenant_id_not_blank', table.tenantId),
organizationTenantScopeFk(
  'fk_organization_role_org_tenant_scope',
  table.organizationId,
  table.tenantScope,
  organization.id,
  organization.tenantScope,
),
```

- [ ] **Step 5: Commit**

```bash
git add src/database/schema/tenant-scope.ts src/database/schema/tenant.ts src/database/schema/better-auth-user.ts src/database/schema/better-auth-organization.ts
git commit -m "$(cat <<'EOF'
feat(schema): add tenant scope keys for user and organization

EOF
)"
```

---

### Task 8: Composite FK pada session, account, member, invitation, passkey, dan two factor

**Files:**

- Modify: `src/database/schema/better-auth-session.ts`
- Modify: `src/database/schema/better-auth-account.ts`
- Modify: `src/database/schema/better-auth-member.ts`
- Modify: `src/database/schema/better-auth-invitation.ts`
- Modify: `src/database/schema/better-auth-passkey.ts`
- Modify: `src/database/schema/better-auth-two-factor.ts`

**Interfaces:**

- Consumes: helper dan `user.tenantScope` / `organization.tenantScope` dari Task 7.
- Produces: constraint dengan nama di tabel bawah. Setiap tabel juga mendapat `tenantScopeColumn()`, check `ck_<tabel>_tenant_id_not_blank`, dan `onDelete: 'restrict'` hanya pada FK ke `tenant.id`. FK `user.id` dan `organization.id` yang sudah `cascade` tetap `cascade`.

| Tabel | User FK | Organization FK |
| --- | --- | --- |
| `session` | `fk_session_user_tenant_scope` pada `(userId, tenantScope)` | `fk_session_active_org_tenant_scope` pada `(activeOrganizationId, tenantScope)` |
| `account` | `fk_account_user_tenant_scope` | tidak ada |
| `member` | `fk_member_user_tenant_scope` | `fk_member_org_tenant_scope` pada `(organizationId, tenantScope)` |
| `invitation` | tidak ada | `fk_invitation_org_tenant_scope` pada `(organizationId, tenantScope)` |
| `passkey` | `fk_passkey_user_tenant_scope` | tidak ada |
| `two_factor` | `fk_two_factor_user_tenant_scope` | tidak ada |

- [ ] **Step 1: Terapkan kolom dan constraint**

Contoh lengkap untuk `session`. Ulangi bentuk yang sama pada lima file lain dengan nama di tabel. Jangan menambahkan FK untuk `invitation.inviterId`.

```ts
tenantScope: tenantScopeColumn(),
```

FK `tenant.id`:

```ts
tenantId: text('tenant_id').references(() => tenant.id, {
  onDelete: 'restrict',
}),
```

Callback `session`:

```ts
tenantIdNotBlank('ck_session_tenant_id_not_blank', table.tenantId),
userTenantScopeFk(
  'fk_session_user_tenant_scope',
  table.userId,
  table.tenantScope,
  user.id,
  user.tenantScope,
),
organizationTenantScopeFk(
  'fk_session_active_org_tenant_scope',
  table.activeOrganizationId,
  table.tenantScope,
  organization.id,
  organization.tenantScope,
),
```

`account` hanya check `ck_account_tenant_id_not_blank` dan `fk_account_user_tenant_scope`.

`member` memakai `ck_member_tenant_id_not_blank`, `fk_member_user_tenant_scope`, dan `fk_member_org_tenant_scope`.

`invitation` memakai `ck_invitation_tenant_id_not_blank` dan `fk_invitation_org_tenant_scope`.

`passkey` memakai `ck_passkey_tenant_id_not_blank` dan `fk_passkey_user_tenant_scope`.

`two_factor` memakai `ck_two_factor_tenant_id_not_blank` dan `fk_two_factor_user_tenant_scope`.

- [ ] **Step 2: Commit**

```bash
git add src/database/schema/better-auth-session.ts src/database/schema/better-auth-account.ts src/database/schema/better-auth-member.ts src/database/schema/better-auth-invitation.ts src/database/schema/better-auth-passkey.ts src/database/schema/better-auth-two-factor.ts
git commit -m "$(cat <<'EOF'
feat(schema): bind auth child rows to the parent tenant scope

EOF
)"
```

---

### Task 9: OAuth, SSO, device code, dan tabel tenant yang tersisa

**Files:**

- Modify: `src/database/schema/better-auth-oauth-provider.ts`
- Modify: `src/database/schema/better-auth-sso.ts`
- Modify: `src/database/schema/better-auth-device-code.ts`
- Modify: `src/database/schema/better-auth-verification.ts`
- Modify: `src/database/schema/better-auth-api-key.ts`
- Modify: `src/database/schema/tenant-billing.ts`
- Modify: `src/database/schema/tenant-auth-feature-config.ts`
- Modify: `src/database/schema/organization-permission.ts`
- Modify: `src/database/schema/organization-role-template.ts`
- Modify: `src/database/schema/audit-trail.ts`

**Interfaces:**

- Consumes: helper Task 7 dan `user.tenantScope`.
- Produces: `tenant_scope` pada setiap tabel yang punya `tenant_id`. User composite FK hanya pada `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `sso_provider`, dan `device_code`.

- [ ] **Step 1: Tabel dengan user FK**

Pada masing-masing tabel di bawah, tambah `tenantScope: tenantScopeColumn()`, ubah FK `tenant.id` menjadi `onDelete: 'restrict'`, tambah check, dan tambah user FK. Jangan mengubah FK `user.id` yang sudah `cascade`.

| Tabel Drizzle | Check | User FK |
| --- | --- | --- |
| `oauthRefreshToken` | `ck_oauth_refresh_token_tenant_id_not_blank` | `fk_oauth_refresh_token_user_tenant_scope` |
| `oauthAccessToken` | `ck_oauth_access_token_tenant_id_not_blank` | `fk_oauth_access_token_user_tenant_scope` |
| `oauthConsent` | `ck_oauth_consent_tenant_id_not_blank` | `fk_oauth_consent_user_tenant_scope` |
| `ssoProvider` | `ck_sso_provider_tenant_id_not_blank` | `fk_sso_provider_user_tenant_scope` |
| `deviceCode` | `ck_device_code_tenant_id_not_blank` | `fk_device_code_user_tenant_scope` |

Panggilan user FK untuk refresh token:

```ts
userTenantScopeFk(
  'fk_oauth_refresh_token_user_tenant_scope',
  table.userId,
  table.tenantScope,
  user.id,
  user.tenantScope,
),
```

Ganti nama constraint sesuai baris tabel untuk empat tabel lain. `walletAddress` dan tabel SCIM tidak punya `tenant_id`; jangan disentuh.

- [ ] **Step 2: Tabel tanpa user FK**

Tambah `tenantScopeColumn()` dan check. Ubah FK `tenant.id` dari `cascade` menjadi `restrict`, kecuali `auditTrailLogs` yang tetap `onDelete: 'set null'`.

| Tabel | Check |
| --- | --- |
| `oauthClient` | `ck_oauth_client_tenant_id_not_blank` |
| `verification` | `ck_verification_tenant_id_not_blank` |
| `apikey` | `ck_apikey_tenant_id_not_blank` |
| `tenantBillingRecords` | `ck_tenant_billing_records_tenant_id_not_blank` |
| `tenantAuthFeatureConfig` | `ck_tenant_auth_feature_config_tenant_id_not_blank` |
| `organizationPermission` | `ck_organization_permission_tenant_id_not_blank` |
| `organizationRoleTemplate` | `ck_organization_role_template_tenant_id_not_blank` |
| `auditTrailLogs` | `ck_audit_trail_logs_tenant_id_not_blank` |

- [ ] **Step 3: Commit**

```bash
git add src/database/schema/better-auth-oauth-provider.ts src/database/schema/better-auth-sso.ts src/database/schema/better-auth-device-code.ts src/database/schema/better-auth-verification.ts src/database/schema/better-auth-api-key.ts src/database/schema/tenant-billing.ts src/database/schema/tenant-auth-feature-config.ts src/database/schema/organization-permission.ts src/database/schema/organization-role-template.ts src/database/schema/audit-trail.ts
git commit -m "$(cat <<'EOF'
feat(schema): restrict tenant deletes and scope credential rows

EOF
)"
```

---

### Task 10: Adapter menolak tulisan lintas tenant

**Files:**

- Modify: `src/modules/auth/multi-tenant/tenant-auth-hooks.ts`
- Test: `src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

**Interfaces:**

- Consumes: `wrapTenantScopedAdapter`.
- Produces: `CROSS_TENANT_USER_SCOPE` dan pemakaian ulang `CROSS_TENANT_ORGANIZATION_ERROR` pada `create` serta `update`.

- [ ] **Step 1: Tes create account dan member**

Tambah tes yang membangun plugin lewat `init`, sama seperti Task 6, lalu memanggil adapter yang dikembalikan `init`:

```ts
it('should reject an account whose user belongs to another tenant', async () => {
  const plugin = buildTenantIsolationPlugin({
    staticTenantContext: null,
    enabledPlugins: {
      twoFactor: false,
      passkey: false,
      apiKey: false,
      deviceAuthorization: false,
      oauthProvider: false,
    },
  });
  const created: unknown[] = [];
  const { adapter } = plugin.init({
    adapter: {
      findOne: async (args: { model: string }) => {
        if (args.model === 'user') return { id: 'usr_b', tenantId: 'ten_b' };
        return null;
      },
      create: async (args: unknown) => {
        created.push(args);
        return args;
      },
    },
  }).context;
  await expectApiCode(
    adapter.create({
      model: 'account',
      data: { userId: 'usr_b', tenantId: 'ten_a', providerId: 'credential', accountId: 'a' },
    }),
    'CROSS_TENANT_USER_SCOPE',
  );
  expect(created).toHaveLength(0);
});
```

Tambah dua tes `member` dengan helper yang sama. Tes pertama: `data` `{ userId: 'usr_a', organizationId: 'org_b', tenantId: 'ten_b', role: 'member' }`, `findOne` mengembalikan `{ tenantId: 'ten_a' }` untuk model `user` dan `{ tenantId: 'ten_b' }` untuk model `organization`. Expected `CROSS_TENANT_USER_SCOPE`, dan `create` dasar tidak dipanggil.

Tes kedua: `data` `{ userId: 'usr_b', organizationId: 'org_a', tenantId: 'ten_b', role: 'member' }`, `findOne` mengembalikan `{ tenantId: 'ten_b' }` untuk `user` dan `{ tenantId: 'ten_a' }` untuk `organization`. Expected `CROSS_TENANT_ORGANIZATION`, dan `create` dasar tidak dipanggil. `expectApiCode` dari Task 6 dipakai lagi.

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

Run: `bun test src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

Expected: FAIL pada tes adapter baru.

- [ ] **Step 3: Cek payload sebelum `create` dan `update`**

Di atas `wrapTenantScopedAdapter`, tambah:

```ts
const USER_TENANT_MATCH_MODELS = new Set([
  'session',
  'account',
  'member',
  'passkey',
  'twoFactor',
  'oauthRefreshToken',
  'oauthAccessToken',
  'oauthConsent',
  'deviceCode',
  'ssoProvider',
]);

const ORG_TENANT_MATCH_FIELD: Record<string, 'organizationId' | 'activeOrganizationId'> = {
  member: 'organizationId',
  invitation: 'organizationId',
  organizationRole: 'organizationId',
  session: 'activeOrganizationId',
};

export const CROSS_TENANT_USER_SCOPE_ERROR = 'CROSS_TENANT_USER_SCOPE';

async function assertPayloadTenantMatch(
  target: GenericAdapter,
  model: string,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (!data || !('tenantId' in data) || !target.findOne) {
    return;
  }
  const rowTenantId = (data.tenantId ?? null) as string | null;

  if (USER_TENANT_MATCH_MODELS.has(model) && typeof data.userId === 'string') {
    const owner = (await target.findOne({
      model: 'user',
      where: [{ field: 'id', value: data.userId, operator: 'eq' }],
    })) as { tenantId?: string | null } | null;
    if (!owner || (owner.tenantId ?? null) !== rowTenantId) {
      throw new APIError('FORBIDDEN', {
        code: CROSS_TENANT_USER_SCOPE_ERROR,
        message: 'tenant_id baris tidak sama dengan tenant user.',
      });
    }
  }

  const orgField = ORG_TENANT_MATCH_FIELD[model];
  const organizationId = orgField ? data[orgField] : undefined;
  if (typeof organizationId === 'string') {
    const org = (await target.findOne({
      model: 'organization',
      where: [{ field: 'id', value: organizationId, operator: 'eq' }],
    })) as { tenantId?: string | null } | null;
    if (!org || (org.tenantId ?? null) !== rowTenantId) {
      throw new APIError('FORBIDDEN', {
        code: CROSS_TENANT_ORGANIZATION_ERROR,
        message: 'tenant_id baris tidak sama dengan tenant organisasi.',
      });
    }
  }
}
```

Panggil `target.findOne`, yaitu method pada objek di dalam `Proxy`, bukan fungsi yang sudah dibungkus filter tenant.

Di cabang `create`, setelah data di-stamp seperti sekarang, panggil `await assertPayloadTenantMatch(target, args.model, data)` sebelum `create` dasar. Stamp yang sudah ada tetap: konteks tenant mengisi `tenantId`, dan model `user` pada konteks platform mengisi `tenantId: null`.

Tambah cabang `update` dan `updateMany` yang tidak mengubah field lain. Bila `data` memuat `tenantId` plus `userId` atau field organization, panggil `assertPayloadTenantMatch` lalu teruskan `data` asli ke method dasar. Jangan menimpa `tenantId` pada update yang tidak mengirim field itu.

`inviterId` tidak dibaca.

- [ ] **Step 4: Jalankan tes dan pastikan lulus**

Run: `bun test src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/multi-tenant/tenant-auth-hooks.ts src/modules/auth/multi-tenant/tenant-auth-hooks.spec.ts
git commit -m "$(cat <<'EOF'
fix(auth): reject adapter writes that disagree with the parent tenant

EOF
)"
```

---

### Task 11: Preflight dan migrasi

**Files:**

- Create: `drizzle/<generated>/migration.sql` lewat `bun run db:generate`
- Modify: snapshot Drizzle yang dihasilkan perintah yang sama

**Interfaces:**

- Consumes: schema Task 7–9.
- Produces: migrasi yang menambah `tenant_scope`, check, unique, composite FK, dan `ON DELETE RESTRICT`.

- [ ] **Step 1: Preflight, jangan memperbaiki data**

Terhadap database pengembangan, jalankan:

```sql
SELECT 'user' AS src, id::text FROM "user" WHERE tenant_id = ''
UNION ALL
SELECT 'session', s.id FROM session s
  JOIN "user" u ON u.id = s.user_id
  WHERE s.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'account', a.id FROM account a
  JOIN "user" u ON u.id = a.user_id
  WHERE a.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'member-user', m.id FROM member m
  JOIN "user" u ON u.id = m.user_id
  WHERE m.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'member-org', m.id FROM member m
  JOIN organization o ON o.id = m.organization_id
  WHERE m.tenant_id IS DISTINCT FROM o.tenant_id
UNION ALL
SELECT 'invitation', i.id FROM invitation i
  JOIN organization o ON o.id = i.organization_id
  WHERE i.tenant_id IS DISTINCT FROM o.tenant_id
UNION ALL
SELECT 'passkey', p.id FROM passkey p
  JOIN "user" u ON u.id = p.user_id
  WHERE p.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'two_factor', t.id FROM two_factor t
  JOIN "user" u ON u.id = t.user_id
  WHERE t.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'oauth_refresh_token', r.id FROM oauth_refresh_token r
  JOIN "user" u ON u.id = r.user_id
  WHERE r.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'oauth_access_token', r.id FROM oauth_access_token r
  JOIN "user" u ON u.id = r.user_id
  WHERE r.user_id IS NOT NULL AND r.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'oauth_consent', c.id FROM oauth_consent c
  JOIN "user" u ON u.id = c.user_id
  WHERE c.user_id IS NOT NULL AND c.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'device_code', d.id FROM device_code d
  JOIN "user" u ON u.id = d.user_id
  WHERE d.user_id IS NOT NULL AND d.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'sso_provider', s.id FROM sso_provider s
  JOIN "user" u ON u.id = s.user_id
  WHERE s.user_id IS NOT NULL AND s.tenant_id IS DISTINCT FROM u.tenant_id
UNION ALL
SELECT 'organization_role', r.id FROM organization_role r
  JOIN organization o ON o.id = r.organization_id
  WHERE r.tenant_id IS DISTINCT FROM o.tenant_id
UNION ALL
SELECT 'session-org', s.id FROM session s
  JOIN organization o ON o.id = s.active_organization_id
  WHERE s.active_organization_id IS NOT NULL
    AND s.tenant_id IS DISTINCT FROM o.tenant_id;
```

Expected: 0 baris. Jika ada baris, berhenti dan laporkan id-nya. Jangan menulis `UPDATE` perbaikan.

- [ ] **Step 2: Generate**

Run: `bun run db:generate`

Expected: satu folder migrasi baru. SQL memuat `GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED`, `uq_user_id_tenant_scope`, `fk_session_user_tenant_scope`, dan `ON DELETE RESTRICT` pada `user.tenant_id`. `audit_trail_logs` tetap `ON DELETE SET NULL`. Jika nama constraint hilang, perbaiki schema TypeScript dan generate ulang. Jangan edit SQL.

- [ ] **Step 3: Migrasi**

Run: `bun run db:migrate`

Expected: log `Drizzle migrations completed successfully.`

- [ ] **Step 4: Commit**

```bash
git add drizzle
git commit -m "$(cat <<'EOF'
feat(db): migrate tenant scope foreign keys and restrict deletes

EOF
)"
```

---

### Task 12: Tes integrasi PostgreSQL

**Files:**

- Create: `src/database/schema/tenant-scope.integrity.spec.ts`

**Interfaces:**

- Consumes: migrasi Task 11 dan `process.env.DATABASE_URL`.
- Produces: tes yang membuat session platform, menolak session yang `tenant_id`-nya berbeda, menolak `DELETE` tenant yang masih punya user, dan mengizinkan `status = 'suspended'`, semuanya di dalam transaksi yang di-rollback.

- [ ] **Step 1: Tulis tes**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool, type PoolClient } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL wajib ada untuk tes tenant scope.');
}

describe('tenant scope integrity', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  it('should accept a platform session, reject a mismatched session, block tenant delete, and allow suspend', async () => {
    const suffix = crypto.randomUUID();
    const platformUserId = `usr_p_${suffix}`;
    const tenantUserId = `usr_t_${suffix}`;
    const tierId = `tier_${suffix}`;
    const tenantId = `ten_${suffix}`;

    await client.query(
      `INSERT INTO auth_tiers (id, code, name) VALUES ($1, $2, 'Test')`,
      [tierId, `code_${suffix}`],
    );
    await client.query(
      `INSERT INTO "user" (id, name, email, tenant_id) VALUES ($1, 'Platform', $2, NULL)`,
      [platformUserId, `p_${suffix}@example.com`],
    );
    await client.query(
      `INSERT INTO tenant (id, name, slug, owner_user_id, tier_id) VALUES ($1, 'Acme', $2, $3, $4)`,
      [tenantId, `acme-${suffix}`, platformUserId, tierId],
    );
    await client.query(
      `INSERT INTO "user" (id, name, email, tenant_id) VALUES ($1, 'Asep', $2, $3)`,
      [tenantUserId, `t_${suffix}@example.com`, tenantId],
    );

    await client.query(
      `INSERT INTO session (id, expires_at, token, user_id, tenant_id)
       VALUES ($1, now() + interval '1 hour', $2, $3, NULL)`,
      [`ses_p_${suffix}`, `tok_p_${suffix}`, platformUserId],
    );

    await expect(
      client.query(
        `INSERT INTO session (id, expires_at, token, user_id, tenant_id)
         VALUES ($1, now() + interval '1 hour', $2, $3, NULL)`,
        [`ses_bad_${suffix}`, `tok_bad_${suffix}`, tenantUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await client.query(
      `INSERT INTO session (id, expires_at, token, user_id, tenant_id)
       VALUES ($1, now() + interval '1 hour', $2, $3, $4)`,
      [`ses_ok_${suffix}`, `tok_ok_${suffix}`, tenantUserId, tenantId],
    );

    await expect(
      client.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]),
    ).rejects.toMatchObject({ code: '23503' });

    const suspended = await client.query(
      `UPDATE tenant SET status = 'suspended' WHERE id = $1 RETURNING status`,
      [tenantId],
    );
    expect(suspended.rows[0].status).toBe('suspended');
  });
});
```

- [ ] **Step 2: Jalankan tes**

Run: `bun test src/database/schema/tenant-scope.integrity.spec.ts`

Expected: PASS. Transaksi berakhir `ROLLBACK`, jadi baris tes tidak tersisa. Jika gagal karena kolom `tenant_scope` belum ada, Task 11 belum di-migrate.

- [ ] **Step 3: Commit**

```bash
git add src/database/schema/tenant-scope.integrity.spec.ts
git commit -m "$(cat <<'EOF'
test(schema): lock tenant scope and block tenant hard delete

EOF
)"
```

---

## Self-review

- Spec §2 cache dan `hasStore`: Task 1–3.
- Spec §3 guard, middleware `/admin`, fallback audit: Task 4–6.
- Spec §4 `tenant_scope`, composite FK, pengecualian `inviter_id` dan `oauth_client`, adapter 403: Task 7–10.
- Spec §5 `RESTRICT` dan audit `SET NULL`: Task 7–9 dan Task 11. `TenantService` tidak diubah.
- Spec §6 tes integrasi: Task 12.
- Spec §7 di luar scope tidak punya task.
