import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import {
  PLATFORM_PERMISSION_META_KEY,
  PlatformPermissionGuard,
  type PlatformPermissionMeta,
} from '../guards/platform-permission.guard';

/**
 * Restricts an endpoint to platform-level users (`tenantId === null`) whose
 * `auth_core_role.permissions` includes the given `"resource:action"` permission.
 */
export const RequirePlatformPermission = (
  permission: string,
): MethodDecorator => {
  const parts = permission.split(':');
  const [resource, action] = parts;

  if (parts.length !== 2 || !resource || !action) {
    throw new Error(
      `Invalid platform permission format: "${permission}". Expected "resource:action"`,
    );
  }

  return applyDecorators(
    SetMetadata(PLATFORM_PERMISSION_META_KEY, {
      resource,
      action,
    } satisfies PlatformPermissionMeta),
    UseGuards(PlatformPermissionGuard),
  );
};
