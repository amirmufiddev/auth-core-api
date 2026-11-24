import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import { assertPlatformAccount } from '@/modules/rbac/services/platform-account';
import { TenantService } from '@/modules/tenant';

interface PortalSessionRequest {
  session?: {
    user?: {
      id?: string;
      tenantId?: string | null;
    } | null;
  } | null;
  params?: {
    tenantId?: string;
  };
}

@Injectable()
export class TenantOwnerGuard implements CanActivate {
  constructor(
    private readonly tenantService: TenantService,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalSessionRequest>();
    const user = request?.session?.user;

    if (!user || !user.id) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }

    if (typeof user.tenantId === 'string' && user.tenantId.length > 0) {
      throw new ForbiddenException(
        'Hanya akun platform yang dapat mengakses portal pelanggan.',
      );
    }

    await assertPlatformAccount(
      this.db,
      user.id,
      'Hanya akun platform yang dapat mengakses portal pelanggan.',
    );

    const tenantId = request.params?.tenantId;
    if (!tenantId) {
      return true;
    }

    const tenant = await this.tenantService.getTenantById(tenantId);
    if (tenant.ownerUserId !== user.id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke tenant ini.');
    }

    return true;
  }
}
