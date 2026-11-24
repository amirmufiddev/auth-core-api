import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  type AgentAuthPluginFactory,
  type AuditLogInput,
  createAuthInstance,
} from './auth';
import { AuthRuntimeRegistry } from './auth-runtime.registry';
import { AuthFeatureConfigService } from './services/auth-feature-config.service';
import { SocialBridgeController } from './social-bridge/social-bridge.controller';
import {
  DrizzleSocialBridgeRepository,
  SOCIAL_BRIDGE_REPOSITORY_TOKEN,
} from './social-bridge/social-bridge.repository';
import {
  FetchSocialBridgeOAuthClient,
  SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
} from './social-bridge/social-bridge.oauth-client';
import { SocialBridgeService } from './social-bridge/social-bridge.service';
import { DatabaseModule } from '@/database/database.module';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import { loadBetterAuthStatement } from '@/modules/rbac/permissions/rbac-permission.loader';
import { EmailModule, EmailService } from '@/modules/email';
import { AppLoggerService } from '@/logger/logger.service';
import { createBetterAuthCorsMiddleware } from '@/bootstrap/cors.config';
import { CryptoModule } from '@/common/crypto';
import {
  BetterAuthCacheModule,
  BETTER_AUTH_SECONDARY_STORAGE,
} from '@/common/auth/better-auth-cache.module';
import {
  type ResolvedTenantContext,
  TenantContextStorage,
} from '@/modules/tenant';
import type { FeatureResolutionService } from '@/modules/feature-tier';

const dynamicEsmImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<Record<string, unknown>>;

@Global()
@Module({
  imports: [DatabaseModule, BetterAuthCacheModule, CryptoModule],
  providers: [AuthFeatureConfigService, AuthRuntimeRegistry],
  exports: [AuthFeatureConfigService, AuthRuntimeRegistry],
})
export class AuthRuntimeCoreModule {}

@Global()
@Module({
  imports: [
    DatabaseModule,
    BetterAuthCacheModule,
    AuthRuntimeCoreModule,
    BetterAuthModule.forRootAsync({
      imports: [EmailModule, DatabaseModule, AuthRuntimeCoreModule],
      inject: [
        ConfigService,
        EmailService,
        AppLoggerService,
        EventEmitter2,
        BETTER_AUTH_SECONDARY_STORAGE,
        DRIZZLE,
        AuthFeatureConfigService,
        AuthRuntimeRegistry,
        ModuleRef,
      ],
      useFactory: async (
        configService: ConfigService,
        emailService: EmailService,
        loggerService: AppLoggerService,
        eventEmitter: EventEmitter2,
        secondaryStorage: unknown,
        db: NodePgDatabase<typeof schema>,
        featureConfigService: AuthFeatureConfigService,
        registry: AuthRuntimeRegistry,
        moduleRef: ModuleRef,
      ) => {
        const betterAuthStatement = await loadBetterAuthStatement(db);
        let currentFeatureConfig =
          await featureConfigService.loadFromDatabase();

        let agentAuthPluginFactory: AgentAuthPluginFactory | undefined;
        try {
          const agentMod = await dynamicEsmImport('@better-auth/agent-auth');
          if (typeof agentMod.agentAuth === 'function') {
            agentAuthPluginFactory =
              agentMod.agentAuth as AgentAuthPluginFactory;
          }
        } catch (error) {
          loggerService.warn(
            `ESM @better-auth/agent-auth tidak dimuat: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'AuthModule',
          );
        }

        const auditLogger = async (entry: AuditLogInput) => {
          await db.insert(schema.auditTrailLogs).values({
            tenantId: entry.tenantId ?? TenantContextStorage.get().tenantId,
            moduleKey: entry.category,
            actorId: entry.actorId ?? null,
            category: entry.category,
            severity: entry.severity,
            actorEmail: entry.actorEmail ?? null,
            actorRole: entry.actorRole ?? null,
            target: entry.target,
            ipAddress: entry.ipAddress ?? null,
            userAgent: entry.userAgent ?? null,
            action: entry.action,
            entityType: entry.category,
            entityId: entry.target,
            metadata: entry.metadata ?? {},
          });
        };

        const tenantBaseDomain =
          configService.get<string>('TENANT_BASE_DOMAIN', { infer: true }) ??
          process.env.TENANT_BASE_DOMAIN ??
          'authcore.local';

        const buildAuth = (
          fc: typeof currentFeatureConfig,
          tenantContext?: ResolvedTenantContext | null,
          decryptedSecrets?: Parameters<
            typeof createAuthInstance
          >[0]['decryptedSecrets'],
        ) =>
          createAuthInstance({
            configService,
            emailService,
            loggerService,
            eventEmitter,
            secondaryStorage: secondaryStorage as Parameters<
              typeof createAuthInstance
            >[0]['secondaryStorage'],
            tenantContext,
            tenantBaseDomain,
            betterAuthStatement,
            featureConfig: fc,
            decryptedSecrets,
            agentAuthPluginFactory,
            auditLogger,
          });

        const getFeatureResolutionService = ():
          FeatureResolutionService | undefined => {
          try {
            return moduleRef.get<FeatureResolutionService>(
              'FEATURE_RESOLUTION_SERVICE',
              { strict: false },
            );
          } catch {
            return undefined;
          }
        };

        const initialAuth = buildAuth(
          currentFeatureConfig,
          null,
          featureConfigService.getDecryptedSecrets(),
        );
        registry.initialize({
          platformInstance: initialAuth,
          buildPlatformAuth: async () => {
            const resolver = getFeatureResolutionService();
            if (resolver) {
              const resolved = await resolver.resolveForPlatform();
              return buildAuth(
                resolved.configMap,
                null,
                resolved.decryptedSecrets,
              );
            }
            const reloaded = await featureConfigService.loadFromDatabase();
            return buildAuth(
              reloaded,
              null,
              featureConfigService.getDecryptedSecrets(),
            );
          },
          buildTenantAuth: async (ctx) => {
            const resolver = getFeatureResolutionService();
            if (resolver && ctx.tenantId) {
              const resolved = await resolver.resolveForTenant(
                ctx.tenantId,
                ctx.tierId,
              );
              return buildAuth(
                resolved.configMap,
                ctx,
                resolved.decryptedSecrets,
              );
            }
            return buildAuth(currentFeatureConfig, ctx);
          },
        });

        featureConfigService.onConfigUpdated(async (nextConfig) => {
          currentFeatureConfig = nextConfig;
          await registry.invalidatePlatform();
          loggerService.log(
            'Better Auth runtime instance reloaded after feature config update.',
            'AuthModule',
          );
        });

        return {
          auth: registry.createContextAwareProxy(),
          isGlobal: true,
          disableGlobalAuthGuard: false,
          disableTrustedOriginsCors: true,
          middleware: createBetterAuthCorsMiddleware(configService),
        };
      },
    }),
  ],
  controllers: [SocialBridgeController],
  providers: [
    SocialBridgeService,
    {
      provide: SOCIAL_BRIDGE_REPOSITORY_TOKEN,
      useClass: DrizzleSocialBridgeRepository,
    },
    {
      provide: SOCIAL_BRIDGE_OAUTH_CLIENT_TOKEN,
      useClass: FetchSocialBridgeOAuthClient,
    },
  ],
  exports: [BetterAuthModule, AuthRuntimeCoreModule, SocialBridgeService],
})
export class AuthModule {}
