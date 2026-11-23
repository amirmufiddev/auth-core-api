import { describe, expect, it, mock } from 'bun:test';
import { authTiersSeeder, buildAuthTierRows } from './auth-tiers.seed';

describe('Auth Tiers Seeder', () => {
  it('should expose seeder name as auth-tiers', () => {
    expect(authTiersSeeder.name).toBe('auth-tiers');
  });

  it('should produce exactly 4 tiers (Free, Basic, Business, Enterprise) without Pro', () => {
    const tiers = buildAuthTierRows();

    expect(tiers).toHaveLength(4);
    expect(tiers.map((t) => t.id)).toEqual([
      'tier_free',
      'tier_basic',
      'tier_business',
      'tier_enterprise',
    ]);
    expect(tiers.map((t) => t.name)).toEqual([
      'Free',
      'Basic',
      'Business',
      'Enterprise',
    ]);
    expect(tiers.map((t) => t.code)).toEqual([
      'free',
      'basic',
      'business',
      'enterprise',
    ]);
    expect(tiers.some((t) => t.name.toLowerCase() === 'pro')).toBe(false);
    expect(tiers.find((t) => t.id === 'tier_free')?.isDefault).toBe(true);
    expect(
      tiers.filter((t) => t.id !== 'tier_free').every((t) => !t.isDefault),
    ).toBe(true);
  });

  it('should upsert all 4 tiers idempotently in authTiersSeeder.run', async () => {
    const executedCalls: Array<{ sql: string; params: unknown[] }> = [];
    const queryMock = mock((sql: string, params: unknown[] = []) => {
      executedCalls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    });

    const fakePool = { query: queryMock } as unknown as any;
    const fakeContext = { db: {} as any, pool: fakePool };

    await authTiersSeeder.run(fakeContext);

    expect(executedCalls).toHaveLength(4);
    for (const call of executedCalls) {
      expect(call.sql).toContain('INSERT INTO "auth_tiers"');
      expect(call.sql).toContain('ON CONFLICT ("id") DO UPDATE');
    }
    expect(executedCalls.map((c) => c.params[0])).toEqual([
      'tier_free',
      'tier_basic',
      'tier_business',
      'tier_enterprise',
    ]);
  });
});
