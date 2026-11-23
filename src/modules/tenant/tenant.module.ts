import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { RbacModule } from '@/modules/rbac';
import { OperatorTenantController } from './controllers/operator-tenant.controller';
import { TENANT_REPOSITORY_TOKEN } from './interfaces/tenant-repository.interface';
import { TenantRepository } from './repositories/tenant.repository';
import { TenantService } from './services/tenant.service';

@Module({
  imports: [DatabaseModule, RbacModule],
  controllers: [OperatorTenantController],
  providers: [
    {
      provide: TENANT_REPOSITORY_TOKEN,
      useClass: TenantRepository,
    },
    TenantService,
  ],
  exports: [TenantService, TENANT_REPOSITORY_TOKEN],
})
export class TenantModule {}
