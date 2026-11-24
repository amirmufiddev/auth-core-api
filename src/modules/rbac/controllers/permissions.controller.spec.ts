// Mock decorators before importing
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => jest.fn(),
  MemberHasPermission: () => jest.fn(),
  OrgRoles: () => jest.fn(),
  AuthService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';
import { DRIZZLE } from '@/database/database.constants';
import { PermissionsController } from './permissions.controller';
import { PermissionScopeService } from '../services/permission-scope.service';
import { PermissionScopeCacheService } from '../services/permission-scope-cache.service';
import { RbacPermissionService } from '../services/rbac-permission.service';
import { getAllPermissionCodes } from '../constants/permissions.constant';
import { PermissionCodesResponseDto } from '../dto/permission.dto';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TenantUserGuard } from '../guards/tenant-user.guard';

function getApiResponseType(
  handler: (...args: unknown[]) => unknown,
  status: number,
) {
  const metadata = Reflect.getMetadata(DECORATORS.API_RESPONSE, handler);
  return metadata?.[status]?.type;
}

const mockCatalog = {
  resources: [
    {
      resource: 'member',
      displayName: 'Anggota',
      actions: { read: { displayName: 'Lihat Anggota' } },
    },
  ],
  permissions: [
    {
      code: 'member:read',
      resource: 'member',
      action: 'read',
      displayName: 'Lihat Anggota',
    },
  ],
};

describe('PermissionsController', () => {
  let controller: PermissionsController;
  let reflector: Reflector;
  let rbacPermissionService: {
    getCatalog: jest.Mock;
    getPermissionCodes: jest.Mock;
  };

  beforeEach(async () => {
    reflector = new Reflector();
    rbacPermissionService = {
      getCatalog: jest.fn().mockResolvedValue(mockCatalog),
      getPermissionCodes: jest.fn().mockResolvedValue(getAllPermissionCodes()),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [
        {
          provide: Reflector,
          useValue: reflector,
        },
        {
          provide: RbacPermissionService,
          useValue: rbacPermissionService,
        },
        {
          provide: DRIZZLE,
          useValue: {},
        },
        {
          provide: PermissionScopeService,
          useValue: {
            resolveScope: jest.fn(),
            createUserScope: jest.fn(),
            createSystemScope: jest.fn(),
          },
        },
        {
          provide: PermissionScopeCacheService,
          useValue: {
            resolveScope: jest.fn(),
            createUserScope: jest.fn(),
            createSystemScope: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PermissionsController>(PermissionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Security & Decorator rules', () => {
    it('should be protected for tenant users', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, PermissionsController);
      expect(guards).toContain(TenantUserGuard);
    });

    it('should not have @AllowAnonymous decorator on endpoints', () => {
      const getPermissionsAllowAnon = Reflect.getMetadata(
        'ALLOW_ANONYMOUS',
        controller.getPermissions,
      );
      const getPermissionCodesAllowAnon = Reflect.getMetadata(
        'ALLOW_ANONYMOUS',
        controller.getPermissionCodes,
      );

      expect(getPermissionsAllowAnon).toBeUndefined();
      expect(getPermissionCodesAllowAnon).toBeUndefined();
    });
  });

  describe('getPermissions', () => {
    it('should return catalog from service', async () => {
      const result = await controller.getPermissions({
        tenantUser: { userId: 'usr_1', tenantId: 'ten_1' },
      });

      expect(rbacPermissionService.getCatalog).toHaveBeenCalledWith('ten_1');
      expect(result.permissions[0].code).toBe('member:read');
    });
  });

  describe('getPermissionCodes', () => {
    it('should return flat array of permission codes', async () => {
      const result = await controller.getPermissionCodes({
        tenantUser: { userId: 'usr_1', tenantId: 'ten_1' },
      });

      expect(result.codes).toContain('member:read');
      expect(result.codes).toContain('feature:read');
    });

    it('should document response as PermissionCodesResponseDto', () => {
      expect(getApiResponseType(controller.getPermissionCodes, 200)).toBe(
        PermissionCodesResponseDto,
      );
    });
  });
});
