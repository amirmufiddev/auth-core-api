import * as crypto from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { BusinessError } from '@/common/errors/business-error';
import { getDefaultRolePermissions } from '@/modules/rbac';
import type {
  ListOrganizationMembersQueryDto,
  ListTenantOrganizationsQueryDto,
  PosSessionContextDto,
} from '../dto/tenant-context.dto';
import {
  TENANT_CONTEXT_REPOSITORY_TOKEN,
  type ITenantContextRepository,
  type TenantApiKeyRecord,
} from '../interfaces/tenant-context-repository.interface';

export function flattenPermissionMatrix(
  rawPermission: string | null | undefined,
  fallbackRole?: string | null,
): string[] {
  let matrix: Record<string, unknown> | null = null;

  if (rawPermission) {
    try {
      const parsed = JSON.parse(rawPermission) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        matrix = parsed as Record<string, unknown>;
      }
    } catch {
      matrix = null;
    }
  }

  if (!matrix && fallbackRole) {
    const defaults = getDefaultRolePermissions();
    if (defaults[fallbackRole]) {
      matrix = defaults[fallbackRole];
    }
  }

  if (!matrix) {
    return [];
  }

  const codes: string[] = [];
  for (const [resource, actions] of Object.entries(matrix)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action === 'string' && action.trim()) {
        codes.push(`${resource}:${action}`);
      }
    }
  }
  return codes;
}

@Injectable()
export class TenantContextService {
  constructor(
    @Inject(TENANT_CONTEXT_REPOSITORY_TOKEN)
    private readonly repo: ITenantContextRepository,
  ) {}

  async assertTenantActive(tenantId: string): Promise<void> {
    const status = await this.repo.findTenantStatus(tenantId);
    if (status === 'suspended') {
      throw new ForbiddenException({
        code: 'TENANT_SUSPENDED',
        message: 'Tenant sedang ditangguhkan.',
      });
    }
  }

  async findApiKeyRecord(rawKey: string): Promise<TenantApiKeyRecord | null> {
    const sha256Base64Url = crypto
      .createHash('sha256')
      .update(rawKey)
      .digest('base64url');
    const byHash = await this.repo.findApiKeyByHashedKey(sha256Base64Url);
    if (byHash) return byHash;
    return this.repo.findApiKeyByHashedKey(rawKey);
  }

  async validateJwtUserForTenant(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const userRecord = await this.repo.findUserTenantId(userId);
    if (!userRecord) {
      throw new UnauthorizedException(
        'User pada Bearer token tidak ditemukan.',
      );
    }
    if (userRecord.tenantId !== tenantId) {
      throw new ForbiddenException({
        code: 'CROSS_TENANT_SESSION',
        message: 'User tidak termasuk dalam tenant yang aktif.',
      });
    }
    if (userRecord.banned) {
      throw new ForbiddenException({
        code: 'USER_BANNED',
        message: 'Akun pengguna sedang diblokir.',
      });
    }
  }

  async getSessionContext(params: {
    tenantId: string;
    userId: string;
    activeOrganizationId: string | null;
  }): Promise<PosSessionContextDto> {
    const userRecord = await this.repo.findUserTenantId(params.userId);
    if (!userRecord) {
      const err = BusinessError.notFound('User', params.userId);
      throw new NotFoundException({
        code: err.code,
        message: err.message,
        ...(err.context ? { context: err.context } : {}),
      });
    }
    if (userRecord.tenantId !== params.tenantId) {
      throw new ForbiddenException({
        code: 'CROSS_TENANT_SESSION',
        message: 'User tidak termasuk dalam tenant yang aktif.',
      });
    }

    if (!params.activeOrganizationId) {
      return {
        userId: params.userId,
        tenantId: params.tenantId,
        activeOrganizationId: null,
        orgRole: null,
        orgPermissions: [],
      };
    }

    const org = await this.repo.findOrganizationById(
      params.activeOrganizationId,
    );
    if (org && org.tenantId !== params.tenantId) {
      throw new ForbiddenException({
        code: 'CROSS_TENANT_ORGANIZATION',
        message:
          'Organisasi tidak termasuk dalam tenant yang aktif pada request ini.',
      });
    }

    if (!org) {
      return {
        userId: params.userId,
        tenantId: params.tenantId,
        activeOrganizationId: null,
        orgRole: null,
        orgPermissions: [],
      };
    }

    const member = await this.repo.findMemberInOrganization(
      params.activeOrganizationId,
      params.userId,
    );
    if (!member) {
      return {
        userId: params.userId,
        tenantId: params.tenantId,
        activeOrganizationId: null,
        orgRole: null,
        orgPermissions: [],
      };
    }

    const rawPermission = await this.repo.findOrganizationRolePermissions(
      params.activeOrganizationId,
      member.role,
    );
    const orgPermissions = flattenPermissionMatrix(rawPermission, member.role);

    return {
      userId: params.userId,
      tenantId: params.tenantId,
      activeOrganizationId: params.activeOrganizationId,
      orgRole: member.role,
      orgPermissions,
    };
  }

  async listOrganizations(params: {
    tenantId: string;
    userId?: string;
    query: ListTenantOrganizationsQueryDto;
  }) {
    const page = Math.max(1, Number(params.query.page ?? 1) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(params.query.limit ?? 20) || 20),
    );
    const offset = (page - 1) * limit;

    const { items, total } = await this.repo.listOrganizationsForTenant({
      tenantId: params.tenantId,
      userId: params.userId,
      search: params.query.search,
      limit,
      offset,
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrganization(params: {
    tenantId: string;
    organizationId: string;
    userId?: string;
  }) {
    const org = await this.repo.findOrganizationById(params.organizationId);
    if (!org) {
      throw new NotFoundException('Organisasi tidak ditemukan.');
    }
    if (org.tenantId !== params.tenantId) {
      throw new ForbiddenException({
        code: 'CROSS_TENANT_ORGANIZATION',
        message:
          'Organisasi tidak termasuk dalam tenant yang aktif pada request ini.',
      });
    }
    if (params.userId) {
      const member = await this.repo.findMemberInOrganization(
        params.organizationId,
        params.userId,
      );
      if (!member) {
        throw new ForbiddenException({
          code: 'NOT_ORGANIZATION_MEMBER',
          message: 'Anda bukan anggota organisasi ini.',
        });
      }
    }
    return org;
  }

  async listOrganizationMembers(params: {
    tenantId: string;
    organizationId: string;
    userId?: string;
    query: ListOrganizationMembersQueryDto;
  }) {
    await this.getOrganization({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      userId: params.userId,
    });

    const page = Math.max(1, Number(params.query.page ?? 1) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(params.query.limit ?? 20) || 20),
    );
    const offset = (page - 1) * limit;

    const { items, total } = await this.repo.listOrganizationMembers({
      organizationId: params.organizationId,
      search: params.query.search,
      limit,
      offset,
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
