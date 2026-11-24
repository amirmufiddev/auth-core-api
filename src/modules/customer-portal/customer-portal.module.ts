import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { BillingModule } from '@/modules/billing';
import { RbacModule } from '@/modules/rbac';
import { TenantModule } from '@/modules/tenant';
import { CustomerPortalController } from './controllers/customer-portal.controller';
import { OperatorTenantUsersController } from './controllers/operator-tenant-users.controller';
import { TenantOwnerGuard } from './guards/tenant-owner.guard';
import { PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN } from './interfaces/portal-oauth-client-repository.interface';
import { PORTAL_TENANT_USER_REPOSITORY_TOKEN } from './interfaces/portal-tenant-user-repository.interface';
import { PortalOAuthClientRepository } from './repositories/portal-oauth-client.repository';
import { PortalTenantUserRepository } from './repositories/portal-tenant-user.repository';
import { CustomerPortalService } from './services/customer-portal.service';
import { PortalTenantUsersService } from './services/portal-tenant-users.service';

@Module({
  imports: [DatabaseModule, TenantModule, BillingModule, RbacModule],
  controllers: [CustomerPortalController, OperatorTenantUsersController],
  providers: [
    {
      provide: PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
      useClass: PortalOAuthClientRepository,
    },
    {
      provide: PORTAL_TENANT_USER_REPOSITORY_TOKEN,
      useClass: PortalTenantUserRepository,
    },
    TenantOwnerGuard,
    CustomerPortalService,
    PortalTenantUsersService,
  ],
  exports: [
    CustomerPortalService,
    PortalTenantUsersService,
    PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
    PORTAL_TENANT_USER_REPOSITORY_TOKEN,
  ],
})
export class CustomerPortalModule {}
