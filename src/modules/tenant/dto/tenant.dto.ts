import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type {
  Tenant,
  TenantBillingStatus,
  TenantStatus,
} from '@/database/schema';

const TENANT_STATUSES = ['active', 'suspended'] as const;
const TENANT_BILLING_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'suspended',
  'manual_invoice',
] as const;

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'acme-corp' })
  @IsString()
  @MinLength(1)
  slug!: string;

  @ApiProperty({ example: 'usr_123' })
  @IsString()
  @MinLength(1)
  ownerUserId!: string;

  @ApiPropertyOptional({ example: 'tier_free', default: 'tier_free' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  tierId?: string;

  @ApiPropertyOptional({ enum: TENANT_BILLING_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(TENANT_BILLING_STATUSES)
  billingStatus?: TenantBillingStatus;
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'Acme Holdings' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({
    description: 'Slug tenant bersifat immutable; mengirim field ini ditolak.',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 'tier_business' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  tierId?: string;

  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;

  @ApiPropertyOptional({ enum: TENANT_BILLING_STATUSES })
  @IsOptional()
  @IsIn(TENANT_BILLING_STATUSES)
  billingStatus?: TenantBillingStatus;
}

export class ChangeTenantTierDto {
  @ApiProperty({ example: 'tier_business' })
  @IsString()
  @MinLength(1)
  tierId!: string;
}

export class ListTenantsQueryDto {
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

  @ApiPropertyOptional({ example: 'tier_free' })
  @IsOptional()
  @IsString()
  tierId?: string;
}

export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty()
  tierId!: string;

  @ApiProperty({ enum: TENANT_STATUSES })
  status!: TenantStatus;

  @ApiProperty({ enum: TENANT_BILLING_STATUSES })
  billingStatus!: TenantBillingStatus;

  @ApiProperty()
  configVersion!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  static fromEntity(entity: Tenant): TenantResponseDto {
    const dto = new TenantResponseDto();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.slug = entity.slug;
    dto.ownerUserId = entity.ownerUserId;
    dto.tierId = entity.tierId;
    dto.status = entity.status;
    dto.billingStatus = entity.billingStatus;
    dto.configVersion = entity.configVersion;
    dto.createdAt = entity.createdAt.toISOString();
    dto.updatedAt = entity.updatedAt.toISOString();
    return dto;
  }
}
