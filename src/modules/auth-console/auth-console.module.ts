import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth';
import { EmailModule } from '@/modules/email';
import { DatabaseModule } from '@/database/database.module';
import { AuthConfigController } from './controllers/auth-config.controller';
import { AuthConsoleController } from './controllers/auth-console.controller';
import { AuthConsoleService } from './services/auth-console.service';

@Module({
  imports: [DatabaseModule, AuthModule, EmailModule],
  controllers: [AuthConfigController, AuthConsoleController],
  providers: [AuthConsoleService],
  exports: [AuthConsoleService],
})
export class AuthConsoleModule {}
