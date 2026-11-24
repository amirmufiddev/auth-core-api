import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { DatabaseModule } from '@/database/database.module';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import { loadBetterAuthStatement } from '@/modules/rbac/permissions/rbac-permission.loader';
import { EmailModule, EmailService } from '@/modules/email';
import { AppLoggerService } from '@/logger/logger.service';
import {
  BetterAuthCacheModule,
  BETTER_AUTH_SECONDARY_STORAGE,
} from '@/common/auth/better-auth-cache.module';
import {
  type ResolvedTenantContext,
  TenantContextStorage,
} from '@/modules/tenant';

const dynamicEsmImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<Record<string, unknown>>;

@Global()
@Module({
  imports: [DatabaseModule, BetterAuthCacheModule],
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
          configService.get<string>('TENANT_BASE_DOMAIN') ??
          process.env.TENANT_BASE_DOMAIN ??
          'authcore.local';

        const buildAuth = (
          fc: typeof currentFeatureConfig,
          tenantContext?: ResolvedTenantContext | null,
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
            agentAuthPluginFactory,
            auditLogger,
          });

        const initialAuth = buildAuth(currentFeatureConfig);
        registry.initialize({
          platformInstance: initialAuth,
          buildPlatformAuth: () => buildAuth(currentFeatureConfig),
          buildTenantAuth: (ctx) => buildAuth(currentFeatureConfig, ctx),
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
        };
      },
    }),
  ],
  exports: [BetterAuthModule, AuthRuntimeCoreModule],
})
export class AuthModule {}
