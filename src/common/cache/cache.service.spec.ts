import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';
import { AppLoggerService } from '@/logger/logger.service';
import { RlsContext } from '@/shared/database/rls-context';

describe('CacheService', () => {
  let service: CacheService;
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let mockLogger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock };

  beforeEach(async () => {
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    mockLogger = {
      warn: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
        {
          provide: AppLoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get(CacheService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('get', () => {
    it('should return value from cacheManager.get when successful', async () => {
      mockCacheManager.get.mockResolvedValueOnce('bar');
      const result = await service.get('foo');
      expect(result).toBe('bar');
      expect(mockCacheManager.get).toHaveBeenCalledWith('foo');
    });

    it('should return undefined when Redis throws', async () => {
      mockCacheManager.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await service.get('foo');
      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cache get failed'),
        'CacheService',
      );
    });
  });

  describe('set', () => {
    it('should call cacheManager.set when successful', async () => {
      mockCacheManager.set.mockResolvedValueOnce(undefined);
      await service.set('foo', 'bar', 1000);
      expect(mockCacheManager.set).toHaveBeenCalledWith('foo', 'bar', 1000);
    });

    it('should not throw when Redis throws', async () => {
      mockCacheManager.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.set('foo', 'bar')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cache set failed'),
        'CacheService',
      );
    });
  });

  describe('del', () => {
    it('should call cacheManager.del when successful', async () => {
      mockCacheManager.del.mockResolvedValueOnce(undefined);
      await service.del('foo');
      expect(mockCacheManager.del).toHaveBeenCalledWith('foo');
    });

    it('should not throw when Redis throws', async () => {
      mockCacheManager.del.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.del('foo')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cache del failed'),
        'CacheService',
      );
    });
  });

  describe('delMany', () => {
    it('should call del for each key provided', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);
      await service.delMany(['k1', 'k2']);
      expect(mockCacheManager.del).toHaveBeenCalledWith('k1');
      expect(mockCacheManager.del).toHaveBeenCalledWith('k2');
    });

    it('should do nothing if keys array is empty', async () => {
      await service.delMany([]);
      expect(mockCacheManager.del).not.toHaveBeenCalled();
    });
  });

  describe('getOrSet', () => {
    it('should return cached value when present without calling factory', async () => {
      mockCacheManager.get.mockResolvedValueOnce('cached-value');
      const factory = jest.fn();
      const result = await service.getOrSet('foo', factory);
      expect(result).toBe('cached-value');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache result when missing', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      mockCacheManager.set.mockResolvedValueOnce(undefined);
      const factory = jest.fn().mockResolvedValue('new-value');
      const result = await service.getOrSet('foo', factory, 5000);
      expect(result).toBe('new-value');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'foo',
        'new-value',
        5000,
      );
    });
  });

  describe('buildTenantKey', () => {
    it('should prefix a tenant id from the current store', () => {
      jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
      jest.spyOn(RlsContext, 'getCurrentTenantId').mockReturnValue('ten_123');
      expect(service.buildTenantKey('user:role:abc', 'app')).toBe(
        'app:tenant:ten_123:user:role:abc',
      );
    });

    it('should use the platform prefix when the store has a null tenant', () => {
      jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
      jest.spyOn(RlsContext, 'getCurrentTenantId').mockReturnValue(null);
      expect(service.buildTenantKey('user:role:abc', 'app')).toBe(
        'app:platform:user:role:abc',
      );
    });

    it('should throw when no store is active', () => {
      jest.spyOn(RlsContext, 'hasStore').mockReturnValue(false);
      expect(() => service.buildTenantKey('user:role:abc', 'app')).toThrow(
        'CacheScopeMissingError',
      );
    });
  });

  describe('buildOrganizationKey', () => {
    it('should prefix the current organization id', () => {
      jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
      jest
        .spyOn(RlsContext, 'getCurrentOrganizationId')
        .mockReturnValue('org_9');
      expect(service.buildOrganizationKey('member:abc', 'app')).toBe(
        'app:org:org_9:member:abc',
      );
    });

    it('should throw when the store has no organization', () => {
      jest.spyOn(RlsContext, 'hasStore').mockReturnValue(true);
      jest.spyOn(RlsContext, 'getCurrentOrganizationId').mockReturnValue(null);
      expect(() => service.buildOrganizationKey('member:abc', 'app')).toThrow(
        'CacheScopeMissingError',
      );
    });
  });

  describe('setTenantScoped', () => {
    it('should write a platform key when tenantId is null', async () => {
      mockCacheManager.set.mockResolvedValueOnce(undefined);
      await service.setTenantScoped(null, 'user:role:xyz', 'val', 'app', 3000);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'app:platform:user:role:xyz',
        'val',
        3000,
      );
    });

    it('should write a tenant key when tenantId is set', async () => {
      mockCacheManager.set.mockResolvedValueOnce(undefined);
      await service.setTenantScoped(
        'ten_999',
        'user:role:xyz',
        'val',
        'app',
        3000,
      );
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'app:tenant:ten_999:user:role:xyz',
        'val',
        3000,
      );
    });
  });

  describe('setOrganizationScoped', () => {
    it('should write an organization key', async () => {
      mockCacheManager.set.mockResolvedValueOnce(undefined);
      await service.setOrganizationScoped(
        'org_3',
        'member:xyz',
        'val',
        'app',
        3000,
      );
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'app:org:org_3:member:xyz',
        'val',
        3000,
      );
    });
  });
});
