import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import { assertPlatformAccount } from '../services/platform-account';

export const PLATFORM_PERMISSION_META_KEY = 'platform_permission_meta';

export interface PlatformPermissionMeta {
  resource: string;
  action: string;
}

interface PlatformSessionRequest {
  session?: {
    user?: {
      id?: string;
      role?: string | null;
      tenantId?: string | null;
    } | null;
  } | null;
}

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<
      PlatformPermissionMeta | undefined
    >(PLATFORM_PERMISSION_META_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<PlatformSessionRequest>();
    const user = request?.session?.user;

    if (!user) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }

    if (!user.id) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }

    if (typeof user.tenantId === 'string' && user.tenantId.length > 0) {
      throw new ForbiddenException(
        'Hanya akun platform yang dapat mengakses fitur ini.',
      );
    }

    const platformUser = await assertPlatformAccount(
      this.db,
      user.id,
      'Hanya akun platform yang dapat mengakses fitur ini.',
    );

    const roleSlugs = (platformUser.role ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);

    if (roleSlugs.length === 0) {
      throw new ForbiddenException('Role platform tidak valid.');
    }

    const roles =
      roleSlugs.length === 1
        ? await this.db
            .select({
              slug: schema.authCoreRole.slug,
              permissions: schema.authCoreRole.permissions,
            })
            .from(schema.authCoreRole)
            .where(eq(schema.authCoreRole.slug, roleSlugs[0]))
            .limit(1)
        : await this.db
            .select({
              slug: schema.authCoreRole.slug,
              permissions: schema.authCoreRole.permissions,
            })
            .from(schema.authCoreRole)
            .where(inArray(schema.authCoreRole.slug, roleSlugs));

    const { resource, action } = requiredPermission;
    const hasPermission = roles.some((role) => {
      const matrix = role.permissions ?? {};
      const resourceActions = matrix[resource];
      const wildcardActions = matrix['*'];
      return (
        (Array.isArray(resourceActions) &&
          (resourceActions.includes(action) ||
            resourceActions.includes('*'))) ||
        (Array.isArray(wildcardActions) &&
          (wildcardActions.includes(action) || wildcardActions.includes('*')))
      );
    });

    if (!hasPermission) {
      throw new ForbiddenException(
        `Permission '${resource}:${action}' diperlukan.`,
      );
    }

    return true;
  }
}
