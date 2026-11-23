import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
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

    if (!user) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }

    if (user.tenantId !== null && user.tenantId !== undefined) {
      throw new ForbiddenException(
        'Hanya akun platform yang dapat mengakses portal pelanggan.',
      );
    }

    if (user.tenantId === undefined) {
      if (!user.id) {
        throw new ForbiddenException(
          'Hanya akun platform yang dapat mengakses portal pelanggan.',
        );
      }

      const [dbUser] = await this.db
        .select({ tenantId: schema.user.tenantId })
        .from(schema.user)
        .where(eq(schema.user.id, user.id))
        .limit(1);

      if (!dbUser || dbUser.tenantId !== null) {
        throw new ForbiddenException(
          'Hanya akun platform yang dapat mengakses portal pelanggan.',
        );
      }
    }

    if (!user.id) {
      throw new ForbiddenException(
        'Identitas pemilik tenant tidak valid pada sesi.',
      );
    }

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
