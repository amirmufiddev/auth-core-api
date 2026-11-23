import { describe, expect, it, mock } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { AuthFeatureConfigService } from './auth-feature-config.service';
import { BETTER_AUTH_FEATURE_CATALOG } from '../config/feature-catalog';

describe('AuthFeatureConfigService', () => {
  const createMockLogger = () =>
    ({
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    }) as any;

  it('should load defaults from env when database table is empty', async () => {
    const dbMock = {
      select: () => ({
        from: () => Promise.resolve([]),
      }),
    } as any;

    const service = new AuthFeatureConfigService(dbMock, createMockLogger());
    const config = await service.loadFromDatabase();

    expect(Object.keys(config).length).toBe(BETTER_AUTH_FEATURE_CATALOG.length);
    expect(config.autumn.enabled).toBe(false);
    expect(config.emailAndPassword.enabled).toBe(true);
  });

  it('should auto-enable dependencies when dependent feature is enabled', async () => {
    const txValues: Array<Record<string, unknown>> = [];
    const dbMock = {
      select: () => ({
        from: () => Promise.resolve([]),
      }),
      transaction: async (cb: (tx: any) => Promise<void>) => {
        const tx = {
          insert: () => ({
            values: (val: Record<string, unknown>) => {
              txValues.push(val);
              return {
                onConflictDoUpdate: () => Promise.resolve(),
              };
            },
          }),
        };
        await cb(tx);
      },
    } as any;

    const service = new AuthFeatureConfigService(dbMock, createMockLogger());
    await service.loadFromDatabase();

    const listener = mock(() => {});
    service.onConfigUpdated(listener);

    const updated = await service.updateConfig(
      {
        scim: { enabled: true },
        sso: { enabled: false },
        organization: { enabled: false },
      },
      'admin@authcore.io',
    );

    expect(updated.scim.enabled).toBe(true);
    expect(updated.sso.enabled).toBe(true);
    expect(updated.organization.enabled).toBe(true);
    expect(txValues.length).toBe(BETTER_AUTH_FEATURE_CATALOG.length);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should throw ForbiddenException when asserting a disabled feature', async () => {
    const dbMock = {
      select: () => ({
        from: () => Promise.resolve([]),
      }),
    } as any;

    const service = new AuthFeatureConfigService(dbMock, createMockLogger());
    await service.loadFromDatabase();

    expect(() => service.assertFeatureEnabled('autumn')).toThrow(
      ForbiddenException,
    );
  });
});
