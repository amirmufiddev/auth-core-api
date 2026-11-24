import { Inject, Injectable } from '@nestjs/common';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import {
  PORTAL_TENANT_ORG_REPOSITORY_TOKEN,
  type IPortalTenantOrgRepository,
} from '../interfaces/portal-tenant-org-repository.interface';
import {
  ListPortalTenantOrgsQueryDto,
  PortalTenantOrgResponseDto,
} from '../dto/customer-portal.dto';

@Injectable()
export class PortalTenantOrgsService {
  constructor(
    @Inject(PORTAL_TENANT_ORG_REPOSITORY_TOKEN)
    private readonly tenantOrgRepository: IPortalTenantOrgRepository,
  ) {}

  async listTenantOrganizations(
    tenantId: string,
    query: ListPortalTenantOrgsQueryDto,
  ): Promise<{
    items: PortalTenantOrgResponseDto[];
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

    const result = await this.tenantOrgRepository.listByTenantPaginated({
      tenantId,
      page,
      pageSize,
      search: trimmedSearch,
    });

    return {
      items: result.items.map(PortalTenantOrgResponseDto.fromEntity),
      total: result.total,
      page,
      pageSize,
    };
  }
}
