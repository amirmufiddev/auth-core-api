import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type {
  TenantBillingRecord,
  TenantBillingRecordStatus,
  TenantBillingStatus,
} from '@/database/schema';

const BILLING_RECORD_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'paid',
  'manual_invoice',
  'void',
] as const;

const TENANT_BILLING_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'suspended',
  'manual_invoice',
] as const;

export class RecordBillingDto {
  @ApiProperty({ example: 'ten_123' })
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @ApiProperty({ example: 'tier_business' })
  @IsString()
  @MinLength(1)
  tierId!: string;

  @ApiProperty({ enum: BILLING_RECORD_STATUSES })
  @IsIn(BILLING_RECORD_STATUSES)
  status!: TenantBillingRecordStatus;

  @ApiProperty({ example: 499000, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: 'IDR', default: 'IDR' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  currency?: string;

  @ApiProperty({ example: '2026-11-01T00:00:00Z' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-12-01T00:00:00Z' })
  @IsDateString()
  periodEnd!: string;

  @ApiPropertyOptional({ example: 'Manual invoice settled via transfer' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    enum: TENANT_BILLING_STATUSES,
    description: 'Override opsional untuk tenant.billingStatus',
  })
  @IsOptional()
  @IsIn(TENANT_BILLING_STATUSES)
  tenantBillingStatus?: TenantBillingStatus;
}

export class ListBillingRecordsQueryDto {
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

  @ApiPropertyOptional({ example: 'ten_123' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ example: 'tier_business' })
  @IsOptional()
  @IsString()
  tierId?: string;

  @ApiPropertyOptional({ enum: BILLING_RECORD_STATUSES })
  @IsOptional()
  @IsIn(BILLING_RECORD_STATUSES)
  status?: TenantBillingRecordStatus;
}

export class BillingRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  tierId!: string;

  @ApiProperty({ enum: BILLING_RECORD_STATUSES })
  status!: TenantBillingRecordStatus;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  periodStart!: string;

  @ApiProperty()
  periodEnd!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true })
  recordedBy!: string | null;

  @ApiProperty()
  createdAt!: string;

  static fromEntity(entity: TenantBillingRecord): BillingRecordResponseDto {
    const dto = new BillingRecordResponseDto();
    dto.id = entity.id;
    dto.tenantId = entity.tenantId;
    dto.tierId = entity.tierId;
    dto.status = entity.status;
    dto.amount = entity.amount;
    dto.currency = entity.currency;
    dto.periodStart = entity.periodStart.toISOString();
    dto.periodEnd = entity.periodEnd.toISOString();
    dto.note = entity.note;
    dto.recordedBy = entity.recordedBy;
    dto.createdAt = entity.createdAt.toISOString();
    return dto;
  }
}
