import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export interface PosSessionContextDto {
  userId: string;
  tenantId: string;
  activeOrganizationId: string | null;
  orgRole: string | null;
  orgPermissions: string[];
}

export interface TenantAuthRequestContext {
  authType: 'bearer' | 'api_key';
  tenantId: string;
  userId: string;
  activeOrganizationId: string | null;
  apiKeyId?: string;
}

export interface TenantContextRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, string | undefined>;
  tenantAuthContext?: TenantAuthRequestContext;
}

class TenantContextPaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class ListTenantOrganizationsQueryDto extends TenantContextPaginationQueryDto {}

export class ListOrganizationMembersQueryDto extends TenantContextPaginationQueryDto {}
