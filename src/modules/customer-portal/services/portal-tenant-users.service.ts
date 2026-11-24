import { Inject, Injectable } from '@nestjs/common';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import {
  PORTAL_TENANT_USER_REPOSITORY_TOKEN,
  type IPortalTenantUserRepository,
} from '../interfaces/portal-tenant-user-repository.interface';
import {
  ListPortalTenantUsersQueryDto,
  PortalTenantUserResponseDto,
} from '../dto/customer-portal.dto';

@Injectable()
export class PortalTenantUsersService {
  constructor(
    @Inject(PORTAL_TENANT_USER_REPOSITORY_TOKEN)
    private readonly tenantUserRepository: IPortalTenantUserRepository,
  ) {}

  async listTenantUsers(
    tenantId: string,
    query: ListPortalTenantUsersQueryDto,
  ): Promise<{
    items: PortalTenantUserResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const requestedSize = query.pageSize ?? query.limit ?? 10;
    const { page, pageSize } = clampZeroBasedPagination(
      query.page ?? 0,
      requestedSize,
    );
    const trimmedSearch = query.search?.trim() || undefined;

    const result = await this.tenantUserRepository.listByTenantPaginated({
      tenantId,
      page,
      pageSize,
      search: trimmedSearch,
    });

    return {
      items: result.items.map(PortalTenantUserResponseDto.fromEntity),
      total: result.total,
      page,
      pageSize,
    };
  }
}
