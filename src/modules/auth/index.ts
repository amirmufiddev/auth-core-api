export { AuthModule } from './auth.module';
export { AuthRuntimeHolder } from './auth-runtime.holder';
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
