import { describe, expect, it, mock } from 'bun:test';
import { BETTER_AUTH_FEATURE_CATALOG } from '@/modules/auth/config/feature-catalog';
import type { SeederContext } from './seeder.interface';
import {
  buildAuthFeatureRows,
  buildTierFeatureMatrix,
  featureTierSeeder,
} from './feature-tier.seed';

describe('feature-tier.seed', () => {
  describe('buildAuthFeatureRows', () => {
    it('should include all 54 features from BETTER_AUTH_FEATURE_CATALOG', () => {
      const rows = buildAuthFeatureRows();
      expect(rows).toHaveLength(54);
      expect(rows).toHaveLength(BETTER_AUTH_FEATURE_CATALOG.length);

      const catalogIds = new Set(BETTER_AUTH_FEATURE_CATALOG.map((f) => f.id));
      const rowCodes = new Set(rows.map((r) => r.code));
      expect(rowCodes).toEqual(catalogIds);
    });

    it('should mark autumn as coming_soon and available features as active', () => {
      const rows = buildAuthFeatureRows();
      const autumn = rows.find((r) => r.code === 'autumn');
      expect(autumn).toBeDefined();
      expect(autumn?.status).toBe('coming_soon');

      const activeRows = rows.filter((r) => r.code !== 'autumn');
      expect(activeRows.every((r) => r.status === 'active')).toBe(true);
    });

    it('should define secret fields with type "secret" in availableSetting', () => {
      const rows = buildAuthFeatureRows();
      const byCode = new Map(rows.map((r) => [r.code, r]));

      const googleSecrets = byCode
        .get('socialGoogle')
        ?.availableSetting.filter((s) => s.type === 'secret')
        .map((s) => s.key);
      expect(googleSecrets).toContain('clientSecret');

      const captchaSecrets = byCode
        .get('captcha')
        ?.availableSetting.filter((s) => s.type === 'secret')
        .map((s) => s.key);
      expect(captchaSecrets).toContain('secretKey');

      const stripeSecrets = byCode
        .get('stripe')
        ?.availableSetting.filter((s) => s.type === 'secret')
        .map((s) => s.key);
      expect(stripeSecrets).toContain('secretKey');
      expect(stripeSecrets).toContain('webhookSecret');

      const dodoSecrets = byCode
        .get('dodoPayments')
        ?.availableSetting.filter((s) => s.type === 'secret')
        .map((s) => s.key);
      expect(dodoSecrets).toContain('apiKey');
      expect(dodoSecrets).toContain('webhookSecret');
    });
  });

  describe('buildTierFeatureMatrix', () => {
    it('should match PRD §12 tier matrix for Free, Basic, Business, and Enterprise', () => {
      const matrix = buildTierFeatureMatrix();

      // Free: core auth, email verification, session
      expect(matrix.free).toContain('emailAndPassword');
      expect(matrix.free).toContain('emailVerification');
      expect(matrix.free).toContain('sessionManagement');
      expect(matrix.free).not.toContain('twoFactor');
      expect(matrix.free).not.toContain('socialGoogle');
      expect(matrix.free).not.toContain('passkey');
      expect(matrix.free).not.toContain('sso');

      // Basic: adds 2FA, magicLink, emailOTP, captcha, Google, GitHub, apiKey
      expect(matrix.basic).toContain('twoFactor');
      expect(matrix.basic).toContain('magicLink');
      expect(matrix.basic).toContain('emailOTP');
      expect(matrix.basic).toContain('captcha');
      expect(matrix.basic).toContain('socialGoogle');
      expect(matrix.basic).toContain('socialGithub');
      expect(matrix.basic).toContain('apiKey');
      expect(matrix.basic).not.toContain('passkey');
      expect(matrix.basic).not.toContain('socialMicrosoft');
      expect(matrix.basic).not.toContain('sso');

      // Business: adds other social providers, passkey, username, phoneNumber, genericOAuth
      expect(matrix.business).toContain('passkey');
      expect(matrix.business).toContain('username');
      expect(matrix.business).toContain('phoneNumber');
      expect(matrix.business).toContain('genericOAuth');
      expect(matrix.business).toContain('socialMicrosoft');
      expect(matrix.business).toContain('socialApple');
      expect(matrix.business).not.toContain('sso');
      expect(matrix.business).not.toContain('scim');
      expect(matrix.business).not.toContain('mcp');

      // Enterprise: adds SSO, SCIM, MCP, agentAuth, openAPI, and all 54 features
      expect(matrix.enterprise).toContain('sso');
      expect(matrix.enterprise).toContain('scim');
      expect(matrix.enterprise).toContain('mcp');
      expect(matrix.enterprise).toContain('agentAuth');
      expect(matrix.enterprise).toContain('openAPI');
      expect(new Set(matrix.enterprise).size).toBe(54);
    });

    it('should be strictly cumulative: free ⊂ basic ⊂ business ⊂ enterprise', () => {
      const matrix = buildTierFeatureMatrix();
      const basicSet = new Set(matrix.basic);
      const businessSet = new Set(matrix.business);
      const enterpriseSet = new Set(matrix.enterprise);

      for (const f of matrix.free) expect(basicSet.has(f)).toBe(true);
      for (const f of matrix.basic) expect(businessSet.has(f)).toBe(true);
      for (const f of matrix.business) expect(enterpriseSet.has(f)).toBe(true);
    });
  });

  describe('featureTierSeeder', () => {
    it('should have name "feature-tier" and upsert auth_features and auth_tier_features idempotently', async () => {
      expect(featureTierSeeder.name).toBe('feature-tier');

      const featureRows = buildAuthFeatureRows();
      const queryMock = mock((sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO "auth_features"')) {
          const code = params?.[0] as string;
          return Promise.resolve({ rows: [{ id: `uuid-${code}`, code }] });
        }
        if (sql.includes('SELECT "id", "code" FROM "auth_tiers"')) {
          return Promise.resolve({
            rows: [
              { id: 'tier_free', code: 'free' },
              { id: 'tier_basic', code: 'basic' },
              { id: 'tier_business', code: 'business' },
              { id: 'tier_enterprise', code: 'enterprise' },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const fakeContext: SeederContext = {
        db: {} as any,
        pool: { query: queryMock } as any,
      };

      await featureTierSeeder.run(fakeContext);

      const featureInserts = queryMock.mock.calls.filter(([sql]) =>
        (sql as string).includes('INSERT INTO "auth_features"'),
      );
      expect(featureInserts).toHaveLength(featureRows.length);

      const tierFeatureInserts = queryMock.mock.calls.filter(([sql]) =>
        (sql as string).includes('INSERT INTO "auth_tier_features"'),
      );
      const matrix = buildTierFeatureMatrix();
      const expectedMappings =
        matrix.free.length +
        matrix.basic.length +
        matrix.business.length +
        matrix.enterprise.length;
      expect(tierFeatureInserts).toHaveLength(expectedMappings);
    });
  });
});
