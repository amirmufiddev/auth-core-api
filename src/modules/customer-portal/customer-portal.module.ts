import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { AuthModule } from '@/modules/auth';
import { BillingModule } from '@/modules/billing';
import { FeatureTierModule } from '@/modules/feature-tier';
import { RbacModule } from '@/modules/rbac';
import { TenantModule } from '@/modules/tenant';
import { CustomerPortalController } from './controllers/customer-portal.controller';
import { OperatorTenantUsersController } from './controllers/operator-tenant-users.controller';
import { TenantOwnerGuard } from './guards/tenant-owner.guard';
import { PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN } from './interfaces/portal-oauth-client-repository.interface';
import { PORTAL_TENANT_API_KEY_REPOSITORY_TOKEN } from './interfaces/portal-tenant-api-key-repository.interface';
import { PORTAL_TENANT_ORG_REPOSITORY_TOKEN } from './interfaces/portal-tenant-org-repository.interface';
import { PORTAL_TENANT_USER_REPOSITORY_TOKEN } from './interfaces/portal-tenant-user-repository.interface';
import { PortalOAuthClientRepository } from './repositories/portal-oauth-client.repository';
import { PortalTenantApiKeyRepository } from './repositories/portal-tenant-api-key.repository';
import { PortalTenantOrgRepository } from './repositories/portal-tenant-org.repository';
import { PortalTenantUserRepository } from './repositories/portal-tenant-user.repository';
import { CustomerPortalService } from './services/customer-portal.service';
import { PortalTenantOrgsService } from './services/portal-tenant-orgs.service';
import { PortalTenantUsersService } from './services/portal-tenant-users.service';
import { PortalTenantApiKeysService } from './services/portal-tenant-api-keys.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    TenantModule,
    BillingModule,
    RbacModule,
    FeatureTierModule,
  ],
  controllers: [CustomerPortalController, OperatorTenantUsersController],
  providers: [
    {
      provide: PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
      useClass: PortalOAuthClientRepository,
    },
    {
      provide: PORTAL_TENANT_API_KEY_REPOSITORY_TOKEN,
      useClass: PortalTenantApiKeyRepository,
    },
    {
      provide: PORTAL_TENANT_USER_REPOSITORY_TOKEN,
      useClass: PortalTenantUserRepository,
    },
    {
      provide: PORTAL_TENANT_ORG_REPOSITORY_TOKEN,
      useClass: PortalTenantOrgRepository,
    },
    TenantOwnerGuard,
    CustomerPortalService,
    PortalTenantUsersService,
    PortalTenantOrgsService,
    PortalTenantApiKeysService,
  ],
  exports: [
    CustomerPortalService,
    PortalTenantUsersService,
    PortalTenantOrgsService,
    PortalTenantApiKeysService,
    PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
    PORTAL_TENANT_API_KEY_REPOSITORY_TOKEN,
    PORTAL_TENANT_USER_REPOSITORY_TOKEN,
    PORTAL_TENANT_ORG_REPOSITORY_TOKEN,
  ],
})
export class CustomerPortalModule {}
