import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { AuthModule } from '@/modules/auth';
import { EmailModule } from '@/modules/email';
import { FeatureTierModule } from '@/modules/feature-tier';
import { RbacModule } from '@/modules/rbac';
import { ActorPermissionsController } from './controllers/actor-permissions.controller';
import { AuthConfigController } from './controllers/auth-config.controller';
import { PlatformConsoleController } from './controllers/platform-console.controller';
import {
  PLATFORM_API_KEY_REPOSITORY_TOKEN,
  PLATFORM_AUDIT_REPOSITORY_TOKEN,
  PLATFORM_OAUTH_CLIENT_REPOSITORY_TOKEN,
  PLATFORM_ORGANIZATION_REPOSITORY_TOKEN,
  PLATFORM_ROLE_REPOSITORY_TOKEN,
  PLATFORM_SESSION_REPOSITORY_TOKEN,
  PLATFORM_SSO_PROVIDER_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from './interfaces';
import { PlatformAuditRepository } from './repositories/platform-audit.repository';
import {
  PlatformApiKeyRepository,
  PlatformOAuthClientRepository,
  PlatformSsoProviderRepository,
} from './repositories/platform-credentials.repository';
import { PlatformOrganizationRepository } from './repositories/platform-organization.repository';
import { PlatformRoleRepository } from './repositories/platform-role.repository';
import { PlatformSessionRepository } from './repositories/platform-session.repository';
import { PlatformUserRepository } from './repositories/platform-user.repository';
import { PlatformActorPermissionsService } from './services/platform-actor-permissions.service';
import { PlatformApiKeysService } from './services/platform-api-keys.service';
import { PlatformAuditService } from './services/platform-audit.service';
import { PlatformMetricsService } from './services/platform-metrics.service';
import { PlatformOAuthSsoService } from './services/platform-oauth-sso.service';
import { PlatformOrganizationsService } from './services/platform-organizations.service';
import { PlatformRolesService } from './services/platform-roles.service';
import { PlatformSessionsService } from './services/platform-sessions.service';
import { PlatformUsersService } from './services/platform-users.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    EmailModule,
    FeatureTierModule,
    RbacModule,
  ],
  controllers: [
    ActorPermissionsController,
    AuthConfigController,
    PlatformConsoleController,
  ],
  providers: [
    {
      provide: PLATFORM_USER_REPOSITORY_TOKEN,
      useClass: PlatformUserRepository,
    },
    {
      provide: PLATFORM_SESSION_REPOSITORY_TOKEN,
      useClass: PlatformSessionRepository,
    },
    {
      provide: PLATFORM_AUDIT_REPOSITORY_TOKEN,
      useClass: PlatformAuditRepository,
    },
    {
      provide: PLATFORM_ROLE_REPOSITORY_TOKEN,
      useClass: PlatformRoleRepository,
    },
    {
      provide: PLATFORM_ORGANIZATION_REPOSITORY_TOKEN,
      useClass: PlatformOrganizationRepository,
    },
    {
      provide: PLATFORM_API_KEY_REPOSITORY_TOKEN,
      useClass: PlatformApiKeyRepository,
    },
    {
      provide: PLATFORM_OAUTH_CLIENT_REPOSITORY_TOKEN,
      useClass: PlatformOAuthClientRepository,
    },
    {
      provide: PLATFORM_SSO_PROVIDER_REPOSITORY_TOKEN,
      useClass: PlatformSsoProviderRepository,
    },
    PlatformActorPermissionsService,
    PlatformAuditService,
    PlatformMetricsService,
    PlatformUsersService,
    PlatformRolesService,
    PlatformSessionsService,
    PlatformOrganizationsService,
    PlatformApiKeysService,
    PlatformOAuthSsoService,
  ],
  exports: [
    PlatformAuditService,
    PlatformMetricsService,
    PlatformUsersService,
    PlatformRolesService,
    PlatformSessionsService,
    PlatformOrganizationsService,
    PlatformApiKeysService,
    PlatformOAuthSsoService,
  ],
})
export class PlatformConsoleModule {}
