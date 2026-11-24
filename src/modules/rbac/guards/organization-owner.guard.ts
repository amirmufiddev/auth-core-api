import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { TenantUserRequest } from './tenant-user.guard';

@Injectable()
export class OrganizationOwnerGuard implements CanActivate {
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
        'Hanya user tenant yang dapat mengelola role organisasi.',
      );
    }

    const organizationId =
      request.session?.session?.activeOrganizationId ?? null;
    if (!organizationId) {
      throw new ForbiddenException('Organisasi aktif diperlukan.');
    }

    const [membership] = await this.db
      .select({
        role: schema.member.role,
        tenantId: schema.member.tenantId,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, user.id),
        ),
      )
      .limit(1);

    const roles = (membership?.role ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);

    if (!roles.includes('owner') || membership?.tenantId !== tenantId) {
      throw new ForbiddenException(
        'Hanya owner organisasi yang dapat mengelola role.',
      );
    }

    request.tenantUser = { userId: user.id, tenantId };
    return true;
  }
}
