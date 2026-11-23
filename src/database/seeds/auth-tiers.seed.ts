import type { Seeder, SeederContext } from './seeder.interface';

export interface AuthTierSeedRow {
  id: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
}

export function buildAuthTierRows(): AuthTierSeedRow[] {
  return [
    {
      id: 'tier_free',
      code: 'free',
      name: 'Free',
      description:
        'Tier dasar gratis untuk autentikasi inti dan maksimal 1 OAuth client.',
      sortOrder: 1,
      isDefault: true,
    },
    {
      id: 'tier_basic',
      code: 'basic',
      name: 'Basic',
      description:
        'Menambahkan 2FA, magic link, email OTP, captcha, API key, dan social login dasar.',
      sortOrder: 2,
      isDefault: false,
    },
    {
      id: 'tier_business',
      code: 'business',
      name: 'Business',
      description:
        'Menambahkan seluruh social provider, passkey, device auth, SIWE, dan multi OAuth client.',
      sortOrder: 3,
      isDefault: false,
    },
    {
      id: 'tier_enterprise',
      code: 'enterprise',
      name: 'Enterprise',
      description:
        'Menambahkan kapabilitas enterprise penuh termasuk SSO, SCIM, MCP, Agent Auth, dan OpenAPI.',
      sortOrder: 4,
      isDefault: false,
    },
  ];
}

export const authTiersSeeder: Seeder = {
  name: 'auth-tiers',
  async run({ pool }: SeederContext): Promise<void> {
    const tiers = buildAuthTierRows();

    for (const tier of tiers) {
      await pool.query(
        `
        INSERT INTO "auth_tiers" (
          "id",
          "code",
          "name",
          "description",
          "sort_order",
          "is_default",
          "created_at",
          "updated_at"
        )
        VALUES ($1, $2, $3, $4, $5, $6, now(), now())
        ON CONFLICT ("id") DO UPDATE
          SET "code" = EXCLUDED.code,
              "name" = EXCLUDED.name,
              "description" = EXCLUDED.description,
              "sort_order" = EXCLUDED.sort_order,
              "is_default" = EXCLUDED.is_default,
              "updated_at" = now();
        `,
        [
          tier.id,
          tier.code,
          tier.name,
          tier.description,
          tier.sortOrder,
          tier.isDefault,
        ],
      );
    }
  },
};
