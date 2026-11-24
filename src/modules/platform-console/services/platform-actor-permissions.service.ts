import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type IPlatformRoleRepository,
  type IPlatformUserRepository,
  PLATFORM_ROLE_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from '../interfaces';

export interface ActorRolePermissions {
  slug: string;
  permissions: Record<string, string[]>;
}

@Injectable()
export class PlatformActorPermissionsService {
  constructor(
    @Inject(PLATFORM_USER_REPOSITORY_TOKEN)
    private readonly userRepo: IPlatformUserRepository,
    @Inject(PLATFORM_ROLE_REPOSITORY_TOKEN)
    private readonly roleRepo: IPlatformRoleRepository,
  ) {}

  async getMine(userId: string): Promise<{ roles: ActorRolePermissions[] }> {
    const user = await this.userRepo.findPlatformById(userId);
    if (!user) {
      throw new ForbiddenException(
        'Hanya akun platform yang dapat mengakses fitur ini.',
      );
    }

    const slugs = (user.role ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);

    const roles: ActorRolePermissions[] = [];
    for (const slug of slugs) {
      const row = await this.roleRepo.findBySlug(slug);
      if (!row) continue;
      roles.push({
        slug: row.slug,
        permissions: row.permissions ?? {},
      });
    }

    return { roles };
  }
}