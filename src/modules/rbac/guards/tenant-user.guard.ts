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

export interface TenantUserContext {
  userId: string;
  tenantId: string;
}

export interface TenantUserRequest {
  session?: {
    user?: {
      id?: string;
      tenantId?: string | null;
    } | null;
    session?: {
      activeOrganizationId?: string | null;
    } | null;
  } | null;
  tenantUser?: TenantUserContext;
}

@Injectable()
export class TenantUserGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantUserRequest>();
    const user = request?.session?.user;

    if (!user?.id) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }

    let tenantId = user.tenantId;
    if (tenantId === undefined) {
      const [dbUser] = await this.db
        .select({ tenantId: schema.user.tenantId })
        .from(schema.user)
        .where(eq(schema.user.id, user.id))
        .limit(1);
      tenantId = dbUser?.tenantId;
    }

    if (!tenantId) {
      throw new ForbiddenException(
        'Hanya user tenant yang dapat mengakses katalog permission organisasi.',
      );
    }

    request.tenantUser = { userId: user.id, tenantId };
    return true;
  }
}
