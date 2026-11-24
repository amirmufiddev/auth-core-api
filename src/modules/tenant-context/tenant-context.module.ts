import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { TenantContextController } from './controllers/tenant-context.controller';
import { TenantApiOrBearerGuard } from './guards/tenant-api-or-bearer.guard';
import { TENANT_CONTEXT_REPOSITORY_TOKEN } from './interfaces/tenant-context-repository.interface';
import { TenantContextRepository } from './repositories/tenant-context.repository';
import { TenantContextService } from './services/tenant-context.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantContextController],
  providers: [
    {
      provide: TENANT_CONTEXT_REPOSITORY_TOKEN,
      useClass: TenantContextRepository,
    },
    TenantContextService,
    TenantApiOrBearerGuard,
  ],
  exports: [TenantContextService, TenantApiOrBearerGuard],
})
export class TenantContextModule {}
