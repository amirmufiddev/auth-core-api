import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, and, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  AuthFeature,
  AuthFeatureConfigRow,
  AuthFeatureStatus,
  AuthTier,
  TenantAuthFeatureConfigRow,
} from '@/database/schema';
import type {
  IFeatureTierRepository,
  TierWithFeatures,
  UpsertTenantFeatureConfigInput,
} from '../interfaces/feature-tier-repository.interface';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class FeatureTierRepository implements IFeatureTierRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listFeatures(): Promise<AuthFeature[]> {
    return this.db
      .select()
      .from(schema.authFeatures)
      .orderBy(
        asc(schema.authFeatures.category),
        asc(schema.authFeatures.code),
      );
  }

  async findFeatureByIdOrCode(idOrCode: string): Promise<AuthFeature | null> {
    const condition = UUID_REGEX.test(idOrCode)
      ? eq(schema.authFeatures.id, idOrCode)
      : eq(schema.authFeatures.code, idOrCode);
    const [row] = await this.db
      .select()
      .from(schema.authFeatures)
      .where(condition)
      .limit(1);
    return row ?? null;
  }

  async updateFeatureStatus(
    featureId: string,
    status: AuthFeatureStatus,
  ): Promise<AuthFeature | null> {
    const [updated] = await this.db
      .update(schema.authFeatures)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.authFeatures.id, featureId))
      .returning();
    return updated ?? null;
  }

  async listTiersWithFeatures(): Promise<TierWithFeatures[]> {
    const tiers = await this.db
      .select()
      .from(schema.authTiers)
      .orderBy(asc(schema.authTiers.sortOrder), asc(schema.authTiers.id));

    const mappings = await this.db
      .select({
        tierId: schema.authTierFeatures.tierId,
        featureId: schema.authTierFeatures.featureId,
        featureCode: schema.authFeatures.code,
      })
      .from(schema.authTierFeatures)
      .innerJoin(
        schema.authFeatures,
        eq(schema.authTierFeatures.featureId, schema.authFeatures.id),
      );

    const byTier = new Map<
      string,
      { featureIds: string[]; featureCodes: string[] }
    >();
    for (const row of mappings) {
      const entry = byTier.get(row.tierId) ?? {
        featureIds: [],
        featureCodes: [],
      };
      entry.featureIds.push(row.featureId);
      entry.featureCodes.push(row.featureCode);
      byTier.set(row.tierId, entry);
    }

    return tiers.map((tier) => {
      const mapped = byTier.get(tier.id);
      return {
        ...tier,
        featureIds: mapped?.featureIds ?? [],
        featureCodes: mapped?.featureCodes ?? [],
      };
    });
  }

  async findTierById(tierId: string): Promise<AuthTier | null> {
    const [row] = await this.db
      .select()
      .from(schema.authTiers)
      .where(eq(schema.authTiers.id, tierId))
      .limit(1);
    return row ?? null;
  }

  async getTierFeatureIds(tierId: string): Promise<string[]> {
    const rows = await this.db
      .select({ featureId: schema.authTierFeatures.featureId })
      .from(schema.authTierFeatures)
      .where(eq(schema.authTierFeatures.tierId, tierId));
    return rows.map((r) => r.featureId);
  }

  async replaceTierFeatures(
    tierId: string,
    featureIds: string[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.authTierFeatures)
        .where(eq(schema.authTierFeatures.tierId, tierId));

      if (featureIds.length > 0) {
        await tx
          .insert(schema.authTierFeatures)
          .values(featureIds.map((featureId) => ({ tierId, featureId })))
          .onConflictDoNothing();
      }
    });
  }

  async listPlatformFeatureConfigs(): Promise<AuthFeatureConfigRow[]> {
    return this.db.select().from(schema.authFeatureConfig);
  }

  async listTenantFeatureConfigs(
    tenantId: string,
  ): Promise<TenantAuthFeatureConfigRow[]> {
    return this.db
      .select()
      .from(schema.tenantAuthFeatureConfig)
      .where(eq(schema.tenantAuthFeatureConfig.tenantId, tenantId));
  }

  async findTenantFeatureConfig(
    tenantId: string,
    featureId: string,
  ): Promise<TenantAuthFeatureConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.tenantAuthFeatureConfig)
      .where(
        and(
          eq(schema.tenantAuthFeatureConfig.tenantId, tenantId),
          eq(schema.tenantAuthFeatureConfig.featureId, featureId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async upsertTenantFeatureConfig(
    input: UpsertTenantFeatureConfigInput,
  ): Promise<TenantAuthFeatureConfigRow> {
    const [row] = await this.db
      .insert(schema.tenantAuthFeatureConfig)
      .values({
        tenantId: input.tenantId,
        featureId: input.featureId,
        enabled: input.enabled,
        settings: input.settings,
        secrets: input.secrets,
        updatedBy: input.updatedBy ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.tenantAuthFeatureConfig.tenantId,
          schema.tenantAuthFeatureConfig.featureId,
        ],
        set: {
          enabled: input.enabled,
          settings: input.settings,
          secrets: input.secrets,
          updatedBy: input.updatedBy ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async bumpTenantConfigVersion(tenantId: string): Promise<number> {
    const [updated] = await this.db
      .update(schema.tenant)
      .set({
        configVersion: sql`${schema.tenant.configVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.tenant.id, tenantId))
      .returning({ configVersion: schema.tenant.configVersion });
    return updated?.configVersion ?? 1;
  }
}
