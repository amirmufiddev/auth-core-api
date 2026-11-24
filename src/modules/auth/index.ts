export { AuthModule } from './auth.module';
export { AuthRuntimeHolder } from './auth-runtime.holder';
export {
  AuthRuntimeRegistry,
  CATALOG_VERSION_REDIS_KEY,
  DEFAULT_AUTH_RUNTIME_LRU_MAX,
  type AuthRuntimeRedisClient,
  type AuthRuntimeRedisSubscriber,
  type AuthRuntimeRegistryInitOptions,
} from './auth-runtime.registry';
export { AuthFeatureConfigService } from './services/auth-feature-config.service';
export {
  BETTER_AUTH_FEATURE_CATALOG,
  BETTER_AUTH_FEATURE_CATALOG_MAP,
  type BetterAuthFeatureCategory,
  type BetterAuthFeatureId,
  type FeatureCatalogEntry,
  type FeatureConfigMap,
  type FeatureRuntimeConfig,
  buildDefaultFeatureConfigFromEnv,
  mergeFeatureConfig,
  normalizeFeatureDependencies,
  sanitizeFeatureConfigForPublic,
} from './config/feature-catalog';
export { type Auth, type AuthDependencies, createAuthInstance } from './auth';
export {
  CROSS_TENANT_OAUTH_CLIENT_ERROR,
  CROSS_TENANT_SESSION_ERROR,
  TENANT_SUSPENDED_ERROR,
  buildTenantIsolationPlugin,
  createTenantDatabaseHooks,
  createTenantMultiTenantPlugins,
  extractOAuthClientIdFromRequest,
  getEffectiveTenantContext,
  resolveTenantCookieConfig,
  type EnabledTenantPlugins,
  type TenantCookieConfig,
} from './multi-tenant/tenant-auth-hooks';
