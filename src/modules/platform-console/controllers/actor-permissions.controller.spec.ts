import { describe, expect, it, mock } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PLATFORM_PERMISSION_META_KEY } from '@/modules/rbac';
import { PlatformConsoleModule } from '../platform-console.module';
import { ActorPermissionsController } from './actor-permissions.controller';

describe('ActorPermissionsController', () => {
  it('returns the service payload for a session and rejects a missing session', async () => {
    const service = {
      getMine: mock(() =>
        Promise.resolve({
          roles: [{ slug: 'auditor', permissions: { auditLog: ['read'] } }],
        }),
      ),
    };
    const controller = new ActorPermissionsController(service as never);

    await expect(
      controller.getPermissions({ user: { id: 'usr_1', email: 'a@b.c' } }),
    ).resolves.toEqual({
      roles: [{ slug: 'auditor', permissions: { auditLog: ['read'] } }],
    });
    expect(service.getMine).toHaveBeenCalledWith('usr_1');

    await expect(controller.getPermissions(null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not require a platform permission and is registered on the module', () => {
    const permission = Reflect.getMetadata(
      PLATFORM_PERMISSION_META_KEY,
      ActorPermissionsController.prototype.getPermissions,
    );
    expect(permission).toBeUndefined();

    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PlatformConsoleModule,
    ) as unknown[];
    expect(controllers).toContain(ActorPermissionsController);
  });
});