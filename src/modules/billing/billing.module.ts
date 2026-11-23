import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { RbacModule } from '@/modules/rbac';
import { OperatorBillingController } from './controllers/operator-billing.controller';
import { BILLING_REPOSITORY_TOKEN } from './interfaces/billing-repository.interface';
import { BillingRepository } from './repositories/billing.repository';
import { BillingService } from './services/billing.service';

@Module({
  imports: [DatabaseModule, RbacModule],
  controllers: [OperatorBillingController],
  providers: [
    {
      provide: BILLING_REPOSITORY_TOKEN,
      useClass: BillingRepository,
    },
    BillingService,
  ],
  exports: [BillingService, BILLING_REPOSITORY_TOKEN],
})
export class BillingModule {}
