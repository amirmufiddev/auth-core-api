import { describe, expect, it } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from './index';

describe('Multi-Tenant Drizzle Schema', () => {
  const dialect = new PgDialect();

  it('should define all 5 new multi-tenant tables and updated authFeatureConfig', () => {
    const authTiersCols = getTableColumns(schema.authTiers);
    expect(authTiersCols.id).toBeDefined();
    expect(authTiersCols.code).toBeDefined();
    expect(authTiersCols.name).toBeDefined();
    expect(authTiersCols.sortOrder).toBeDefined();
    expect(authTiersCols.isDefault).toBeDefined();

    const authFeaturesCols = getTableColumns(schema.authFeatures);
    expect(authFeaturesCols.id.dataType).toBe('string');
    expect(authFeaturesCols.id.columnType).toBe('PgUUID');
    expect(authFeaturesCols.code).toBeDefined();
    expect(authFeaturesCols.status).toBeDefined();
    expect(authFeaturesCols.dependencies).toBeDefined();
    expect(authFeaturesCols.availableSetting).toBeDefined();

    const authTierFeaturesCols = getTableColumns(schema.authTierFeatures);
    expect(authTierFeaturesCols.tierId).toBeDefined();
    expect(authTierFeaturesCols.featureId).toBeDefined();

    const tenantCols = getTableColumns(schema.tenant);
    expect(tenantCols.id).toBeDefined();
    expect(tenantCols.slug).toBeDefined();
    expect(tenantCols.ownerUserId).toBeDefined();
    expect(tenantCols.tierId).toBeDefined();
    expect(tenantCols.status).toBeDefined();
    expect(tenantCols.billingStatus).toBeDefined();
    expect(tenantCols.configVersion).toBeDefined();

    const billingCols = getTableColumns(schema.tenantBillingRecords);
    expect(billingCols.id.columnType).toBe('PgUUID');
    expect(billingCols.tenantId).toBeDefined();
    expect(billingCols.tierId).toBeDefined();
    expect(billingCols.status).toBeDefined();
    expect(billingCols.amount).toBeDefined();
    expect(billingCols.currency).toBeDefined();
    expect(billingCols.periodStart).toBeDefined();
    expect(billingCols.periodEnd).toBeDefined();
    expect(billingCols.recordedBy).toBeDefined();

    const tenantConfigCols = getTableColumns(schema.tenantAuthFeatureConfig);
    expect(tenantConfigCols.tenantId).toBeDefined();
    expect(tenantConfigCols.featureId.columnType).toBe('PgUUID');
    expect(tenantConfigCols.enabled).toBeDefined();
    expect(tenantConfigCols.settings).toBeDefined();
    expect(tenantConfigCols.secrets).toBeDefined();

    const platformConfigCols = getTableColumns(schema.authFeatureConfig);
    expect(platformConfigCols.featureId.columnType).toBe('PgUUID');
    expect(platformConfigCols.secrets).toBeDefined();
  });

  it('should include tenantId column on all target multi-tenant and child tables', () => {
    const tablesWithTenantId = [
      schema.user,
      schema.session,
      schema.organization,
      schema.organizationRole,
      schema.organizationPermission,
      schema.organizationRoleTemplate,
      schema.member,
      schema.invitation,
      schema.account,
      schema.passkey,
      schema.twoFactor,
      schema.oauthClient,
      schema.oauthAccessToken,
      schema.oauthRefreshToken,
      schema.oauthConsent,
      schema.verification,
      schema.apikey,
      schema.deviceCode,
      schema.ssoProvider,
      schema.auditTrailLogs,
    ];

    for (const table of tablesWithTenantId) {
      const cols = getTableColumns(table);
      expect(cols.tenantId).toBeDefined();
      expect(cols.tenantId.name).toBe('tenant_id');
    }

    const orgCols = getTableColumns(schema.organization);
    expect(orgCols.tenantId.notNull).toBe(true);

    const userCols = getTableColumns(schema.user);
    expect(userCols.tenantId.notNull).toBe(false);
  });

  it('should configure 6 partial unique indexes on user and drop global unique on email/username/phoneNumber', () => {
    const userCols = getTableColumns(schema.user);
    expect(userCols.email.isUnique).toBe(false);
    expect(userCols.username.isUnique).toBe(false);
    expect(userCols.phoneNumber.isUnique).toBe(false);

    const userConfig = getTableConfig(schema.user);
    const expectedIndexes = [
      'uq_user_platform_email',
      'uq_user_tenant_email',
      'uq_user_platform_username',
      'uq_user_tenant_username',
      'uq_user_platform_phone',
      'uq_user_tenant_phone',
    ];

    for (const indexName of expectedIndexes) {
      const idx = userConfig.indexes.find((i) => i.config.name === indexName);
      expect(idx).toBeDefined();
      expect(idx?.config.unique).toBe(true);
      expect(idx?.config.where).toBeDefined();
      const whereSql = dialect.sqlToQuery(idx!.config.where!).sql;
      expect(whereSql.length).toBeGreaterThan(0);
    }

    const platformEmailWhere = dialect.sqlToQuery(
      userConfig.indexes.find(
        (i) => i.config.name === 'uq_user_platform_email',
      )!.config.where!,
    ).sql;
    expect(platformEmailWhere).toContain('IS NULL');

    const tenantEmailWhere = dialect.sqlToQuery(
      userConfig.indexes.find((i) => i.config.name === 'uq_user_tenant_email')!
        .config.where!,
    ).sql;
    expect(tenantEmailWhere).toContain('IS NOT NULL');
  });

  it('should configure composite uq_organization_tenant_slug and remove global unique on slug', () => {
    const orgCols = getTableColumns(schema.organization);
    expect(orgCols.slug.isUnique).toBe(false);

    const orgConfig = getTableConfig(schema.organization);
    const slugUq = orgConfig.indexes.find(
      (i) => i.config.name === 'uq_organization_tenant_slug',
    );
    expect(slugUq).toBeDefined();
    expect(slugUq?.config.unique).toBe(true);
    expect(slugUq?.config.columns.map((c) => c.name)).toEqual([
      'tenant_id',
      'slug',
    ]);
  });

  it('should configure 2 partial unique indexes on account and remove global provider/account unique index', () => {
    const accountConfig = getTableConfig(schema.account);
    expect(
      accountConfig.indexes.find(
        (i) => i.config.name === 'idx_account_provider_account_unique',
      ),
    ).toBeUndefined();

    const platformIdx = accountConfig.indexes.find(
      (i) => i.config.name === 'uq_account_platform_provider_account',
    );
    expect(platformIdx).toBeDefined();
    expect(platformIdx?.config.unique).toBe(true);
    expect(platformIdx?.config.columns.map((c) => c.name)).toEqual([
      'provider_id',
      'account_id',
    ]);
    expect(platformIdx?.config.where).toBeDefined();
    expect(dialect.sqlToQuery(platformIdx!.config.where!).sql).toContain(
      'IS NULL',
    );

    const tenantIdx = accountConfig.indexes.find(
      (i) => i.config.name === 'uq_account_tenant_provider_account',
    );
    expect(tenantIdx).toBeDefined();
    expect(tenantIdx?.config.unique).toBe(true);
    expect(tenantIdx?.config.columns.map((c) => c.name)).toEqual([
      'tenant_id',
      'provider_id',
      'account_id',
    ]);
    expect(tenantIdx?.config.where).toBeDefined();
    expect(dialect.sqlToQuery(tenantIdx!.config.where!).sql).toContain(
      'IS NOT NULL',
    );
  });

  it('should use set null on auditTrailLogs.tenantId FK and restrict on operational tables', () => {
    const auditConfig = getTableConfig(schema.auditTrailLogs);
    const auditTenantFk = auditConfig.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'tenant_id'),
    );
    expect(auditTenantFk).toBeDefined();
    expect(auditTenantFk?.onDelete).toBe('set null');

    const sessionConfig = getTableConfig(schema.session);
    const sessionTenantFk = sessionConfig.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'tenant_id'),
    );
    expect(sessionTenantFk).toBeDefined();
    expect(sessionTenantFk?.onDelete).toBe('restrict');
  });
});
