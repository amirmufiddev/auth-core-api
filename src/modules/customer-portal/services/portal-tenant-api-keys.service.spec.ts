import 'reflect-metadata';
import { describe, expect, it, mock } from 'bun:test';
import { BusinessError } from '@/common/errors/business-error';
import type { Tenant } from '@/database/schema';
import { PortalTenantApiKeysService } from './portal-tenant-api-keys.service';

describe('PortalTenantApiKeysService', () => {
  const makeTenant = (overrides: Partial<Tenant> = {}): Tenant => ({
    id: 'ten_amir',
    name: 'POS Amir',
    slug: 'pos-amir',
    ownerUserId: 'usr_amir',
    tierId: 'tier_basic',
    status: 'active',
    billingStatus: 'active',
    configVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('should reject list when apiKey feature is disabled for tenant tier', async () => {
    const tenantService = {
      getTenantById: mock(() => Promise.resolve(makeTenant())),
    };
    const featureResolution = {
      resolveForTenant: mock(() =>
        Promise.resolve({
          configMap: { apiKey: { enabled: false, settings: {} } },
          decryptedSecrets: {},
          configVersion: 2,
          catalogVersion: 1,
        }),
      ),
    };

    const service = new PortalTenantApiKeysService(
      tenantService as never,
      featureResolution as never,
      { getForContext: mock() } as never,
      { listByTenantPaginated: mock() } as never,
    );

    try {
      await service.listTenantApiKeys('ten_amir', { page: 0, pageSize: 10 });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessError);
      expect((error as BusinessError).code).toBe('FEATURE_UNAVAILABLE');
    }
  });

  it('should list only tenant-scoped keys via repository', async () => {
    const tenantService = {
      getTenantById: mock(() => Promise.resolve(makeTenant())),
    };
    const featureResolution = {
      resolveForTenant: mock(() =>
        Promise.resolve({
          configMap: { apiKey: { enabled: true, settings: {} } },
          decryptedSecrets: {},
          configVersion: 2,
          catalogVersion: 1,
        }),
      ),
    };
    const listByTenantPaginated = mock(() =>
      Promise.resolve({
        items: [
          {
            apiKey: {
              id: 'key_1',
              tenantId: 'ten_amir',
              name: 'POS',
              prefix: 'ak_live_',
              start: 'ak_li',
              rateLimitMax: 100,
              rateLimitTimeWindow: 60000,
              enabled: true,
              requestCount: 0,
              lastRequest: null,
              expiresAt: null,
              createdAt: new Date(),
              permissions: JSON.stringify({ general: ['sessions:verify'] }),
              referenceId: 'usr_amir',
            },
            ownerEmail: 'amir@example.com',
          },
        ],
        total: 1,
      }),
    );

    const service = new PortalTenantApiKeysService(
      tenantService as never,
      featureResolution as never,
      { getForContext: mock() } as never,
      { listByTenantPaginated } as never,
    );

    const result = await service.listTenantApiKeys('ten_amir', {
      page: 0,
      pageSize: 10,
    });

    expect(listByTenantPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'ten_amir' }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.tenantId).toBe('ten_amir');
    expect(result.items[0]?.scopes).toContain('sessions:verify');
  });
});