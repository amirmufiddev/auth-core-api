import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type {
  TenantBillingRecordStatus,
  TenantBillingStatus,
  TenantStatus,
} from '@/database/schema';
import { BillingRecordResponseDto } from '@/modules/billing';
import type { PortalOAuthClientType } from '../interfaces/portal-oauth-client-repository.interface';

const TENANT_STATUSES = ['active', 'suspended'] as const;
const OAUTH_CLIENT_TYPES = [
  'oidc-confidential',
  'oidc-public',
  'mcp-client',
] as const;
const BILLING_RECORD_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'paid',
  'manual_invoice',
  'void',
] as const;

export class CreatePortalTenantDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'acme-corp' })
  @IsString()
  @MinLength(1)
  slug!: string;

  @ApiPropertyOptional({ example: 'tier_free', default: 'tier_free' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  tierId?: string;
}

export class UpdatePortalTenantDto {
  @ApiPropertyOptional({ example: 'Acme Holdings' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Slug bersifat immutable; mengirim field ini ditolak 400 TENANT_SLUG_IMMUTABLE',
  })
  @IsOptional()
  @IsString()
  slug?: string;
}

export class ListPortalTenantsQueryDto {
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: 'Cari berdasarkan nama atau slug' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;
}

export class CreatePortalOAuthClientDto {
  @ApiProperty({ example: 'Acme Web Portal' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: OAUTH_CLIENT_TYPES })
  @IsIn(OAUTH_CLIENT_TYPES)
  type!: PortalOAuthClientType;

  @ApiProperty({ example: ['https://acme.example.com/callback'] })
  @IsArray()
  @IsString({ each: true })
  redirectUris!: string[];

  @ApiProperty({ example: ['openid', 'profile', 'email'] })
  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @ApiProperty({ example: true })
  @IsBoolean()
  pkceRequired!: boolean;
}

export class ListPortalOAuthClientsQueryDto {
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: 'Cari berdasarkan nama atau clientId' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ListPortalBillingQueryDto {
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ enum: BILLING_RECORD_STATUSES })
  @IsOptional()
  @IsIn(BILLING_RECORD_STATUSES)
  status?: TenantBillingRecordStatus;
}

export class PortalOAuthClientResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  clientId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: OAUTH_CLIENT_TYPES })
  type!: PortalOAuthClientType;

  @ApiProperty({ type: [String] })
  redirectUris!: string[];

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty()
  pkceRequired!: boolean;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({
    description:
      'Hanya dikembalikan satu kali saat pembuatan client confidential/MCP.',
  })
  plainClientSecret?: string;
}

export class PortalBillingSummaryResponseDto {
  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  tierId!: string;

  @ApiProperty()
  billingStatus!: TenantBillingStatus;

  @ApiProperty({ type: [BillingRecordResponseDto] })
  items!: BillingRecordResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
