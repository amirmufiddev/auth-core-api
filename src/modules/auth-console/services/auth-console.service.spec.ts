import { describe, expect, it, mock } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthConsoleService } from './auth-console.service';

describe('AuthConsoleService', () => {
  const createConfigMock = () =>
    ({
      get: mock((key: string) => {
        if (key === 'app') return { appName: 'Auth Core' };
        if (key === 'auth.clientUrl') return 'http://localhost:2000';
        return undefined;
      }),
    }) as any;

  it('should block deleting system roles in deleteRole', async () => {
    const dbMock = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: 'role_super_admin',
                  slug: 'super_admin',
                  isSystem: true,
                },
              ]),
          }),
        }),
      }),
    } as any;

    const featureConfigMock = {
      assertFeatureEnabled: mock(() => {}),
      isFeatureEnabled: mock(() => true),
    } as any;

    const service = new AuthConsoleService(
      dbMock,
      featureConfigMock,
      { send: mock(() => Promise.resolve()) } as any,
      createConfigMock(),
    );

    await expect(
      service.deleteRole('role_super_admin', {
        id: 'usr_1',
        email: 'admin@authcore.io',
        role: 'super_admin',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should enforce feature flag gating in listApiKeys', async () => {
    const featureConfigMock = {
      assertFeatureEnabled: mock(() => {
        throw new ForbiddenException('FEATURE_DISABLED');
      }),
    } as any;

    const service = new AuthConsoleService(
      {} as any,
      featureConfigMock,
      { send: mock(() => Promise.resolve()) } as any,
      createConfigMock(),
    );

    await expect(
      service.listApiKeys({ page: 0, pageSize: 10 }),
    ).rejects.toThrow(ForbiddenException);
  });
});
