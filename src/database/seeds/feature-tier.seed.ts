import {
  BETTER_AUTH_FEATURE_CATALOG,
  type BetterAuthFeatureId,
  type FeatureCatalogEntry,
} from '@/modules/auth/config/feature-catalog';
import type {
  AuthFeatureAvailableSetting,
  AuthFeatureStatus,
} from '../schema/auth-feature';
import type { Seeder, SeederContext } from './seeder.interface';

export type TierCode = 'free' | 'basic' | 'business' | 'enterprise';

export interface AuthFeatureSeedRow {
  code: BetterAuthFeatureId;
  name: string;
  description: string;
  category: string;
  packageName: string;
  status: AuthFeatureStatus;
  dependencies: BetterAuthFeatureId[];
  availableSetting: AuthFeatureAvailableSetting[];
}

const FEATURE_SECRET_FIELDS: Partial<
  Record<BetterAuthFeatureId, AuthFeatureAvailableSetting[]>
> = {
  genericOAuth: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialGoogle: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialGithub: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialMicrosoft: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialApple: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialDiscord: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialGitlab: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialSlack: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialLinkedin: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialTwitter: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialFigma: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialNotion: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialLinear: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialVercel: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  captcha: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
  ],
  haveIBeenPwned: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: false },
  ],
  sso: [
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: false,
    },
  ],
  scim: [
    { key: 'scimToken', label: 'SCIM Token', type: 'secret', required: false },
  ],
  stripe: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  polar: [
    {
      key: 'accessToken',
      label: 'Access Token',
      type: 'secret',
      required: true,
    },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  autumn: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
  ],
  dodoPayments: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  creem: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  chargebee: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
};

function toLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function buildAvailableSettings(
  item: FeatureCatalogEntry,
): AuthFeatureAvailableSetting[] {
  const settings: AuthFeatureAvailableSetting[] = [];
  const seenKeys = new Set<string>();
  const explicitSecretKeys = new Set(
    (FEATURE_SECRET_FIELDS[item.id] ?? [])
      .filter((field) => field.type === 'secret')
      .map((field) => field.key),
  );

  for (const [key, value] of Object.entries(item.defaultSettings)) {
    seenKeys.add(key);
    const isSecret = explicitSecretKeys.has(key);
    const type = isSecret
      ? 'secret'
      : typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? 'number'
          : 'string';

    settings.push({
      key,
      label: toLabel(key),
      type,
      ...(isSecret ? {} : { defaultValue: value }),
    });
  }

  const extraFields = FEATURE_SECRET_FIELDS[item.id] ?? [];
  for (const field of extraFields) {
    if (!seenKeys.has(field.key)) {
      seenKeys.add(field.key);
      settings.push(field);
    }
  }

  return settings;
}

export function buildAuthFeatureRows(): AuthFeatureSeedRow[] {
  return BETTER_AUTH_FEATURE_CATALOG.map((item) => ({
    code: item.id,
    name: item.name,
    description: item.unavailableReason ?? `${item.name} (${item.category})`,
    category: item.category,
    packageName: item.packageName,
    status: item.available ? 'active' : 'coming_soon',
    dependencies: item.dependencies ?? [],
    availableSetting: buildAvailableSettings(item),
  }));
}

export function buildTierFeatureMatrix(): Record<
  TierCode,
  BetterAuthFeatureId[]
> {
  const free: BetterAuthFeatureId[] = [
    'emailAndPassword',
    'emailVerification',
    'sessionManagement',
    'accountLinking',
    'rateLimit',
    'lastLoginMethod',
    'i18n',
    'bearer',
    'jwt',
    'oauthProvider',
  ];

  const basic: BetterAuthFeatureId[] = [
    ...free,
    'twoFactor',
    'magicLink',
    'emailOTP',
    'captcha',
    'socialGoogle',
    'socialGithub',
    'apiKey',
    'haveIBeenPwned',
    'oneTimeToken',
    'multiSession',
  ];

  const business: BetterAuthFeatureId[] = [
    ...basic,
    'passkey',
    'username',
    'phoneNumber',
    'anonymous',
    'oneTap',
    'siwe',
    'genericOAuth',
    'socialMicrosoft',
    'socialApple',
    'socialDiscord',
    'socialGitlab',
    'socialSlack',
    'socialLinkedin',
    'socialTwitter',
    'socialFigma',
    'socialNotion',
    'socialLinear',
    'socialVercel',
    'organization',
    'deviceAuthorization',
    'oauthProxy',
    'auditLogs',
  ];

  const enterprise: BetterAuthFeatureId[] = [
    ...business,
    'sso',
    'scim',
    'mcp',
    'agentAuth',
    'openAPI',
    'admin',
    'stripe',
    'polar',
    'autumn',
    'dodoPayments',
    'creem',
    'chargebee',
  ];

  return {
    free,
    basic,
    business,
    enterprise,
  };
}

export const featureTierSeeder: Seeder = {
  name: 'feature-tier',
  async run({ pool }: SeederContext): Promise<void> {
    const featureRows = buildAuthFeatureRows();
    const featureIdByCode = new Map<BetterAuthFeatureId, string>();

    for (const feature of featureRows) {
      const result = await pool.query<{ id: string; code: string }>(
        `
        INSERT INTO "auth_features" (
          "code",
          "name",
          "description",
          "category",
          "package_name",
          "status",
          "dependencies",
          "available_setting",
          "created_at",
          "updated_at"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb, now(), now())
        ON CONFLICT ("code") DO UPDATE
          SET "name" = EXCLUDED.name,
              "description" = EXCLUDED.description,
              "category" = EXCLUDED.category,
              "package_name" = EXCLUDED.package_name,
              "status" = EXCLUDED.status,
              "dependencies" = EXCLUDED.dependencies,
              "available_setting" = EXCLUDED.available_setting,
              "updated_at" = now()
        RETURNING "id", "code";
        `,
        [
          feature.code,
          feature.name,
          feature.description,
          feature.category,
          feature.packageName,
          feature.status,
          feature.dependencies,
          JSON.stringify(feature.availableSetting),
        ],
      );

      const insertedId = result.rows[0]?.id;
      if (insertedId) {
        featureIdByCode.set(feature.code, insertedId);
      }
    }

    const tiersResult = await pool.query<{ id: string; code: string }>(
      `SELECT "id", "code" FROM "auth_tiers";`,
    );
    const tierIdByCode = new Map<string, string>(
      tiersResult.rows.map((row) => [row.code, row.id]),
    );

    const matrix = buildTierFeatureMatrix();
    for (const [tierCode, featureCodes] of Object.entries(matrix) as Array<
      [TierCode, BetterAuthFeatureId[]]
    >) {
      const tierId = tierIdByCode.get(tierCode);
      if (!tierId) {
        throw new Error(
          `Tier "${tierCode}" not found in auth_tiers. Run auth-tiers seeder first.`,
        );
      }

      for (const featureCode of featureCodes) {
        const featureId = featureIdByCode.get(featureCode);
        if (!featureId) {
          throw new Error(
            `Feature "${featureCode}" was not upserted into auth_features.`,
          );
        }

        await pool.query(
          `
          INSERT INTO "auth_tier_features" ("tier_id", "feature_id")
          VALUES ($1, $2)
          ON CONFLICT ("tier_id", "feature_id") DO NOTHING;
          `,
          [tierId, featureId],
        );
      }
    }
  },
};
