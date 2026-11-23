import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { BillingModule } from '@/modules/billing';
import { TenantModule } from '@/modules/tenant';
import { CustomerPortalController } from './controllers/customer-portal.controller';
import { TenantOwnerGuard } from './guards/tenant-owner.guard';
import { PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN } from './interfaces/portal-oauth-client-repository.interface';
import { PortalOAuthClientRepository } from './repositories/portal-oauth-client.repository';
import { CustomerPortalService } from './services/customer-portal.service';

@Module({
  imports: [DatabaseModule, TenantModule, BillingModule],
  controllers: [CustomerPortalController],
  providers: [
    {
      provide: PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN,
      useClass: PortalOAuthClientRepository,
    },
    TenantOwnerGuard,
    CustomerPortalService,
  ],
  exports: [CustomerPortalService, PORTAL_OAUTH_CLIENT_REPOSITORY_TOKEN],
})
export class CustomerPortalModule {}
