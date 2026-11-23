import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  registerDecorator,
  type ValidationOptions,
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

const DANGEROUS_URI_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
]);

const CUSTOM_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:$/;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimStringArray = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

export function isValidOAuthRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (DANGEROUS_URI_SCHEMES.has(protocol)) {
    return false;
  }

  if (protocol === 'https:' || protocol === 'http:') {
    return Boolean(parsed.hostname);
  }

  if (!CUSTOM_SCHEME_REGEX.test(protocol)) {
    return false;
  }

  return Boolean(parsed.host || (parsed.pathname && parsed.pathname !== '/'));
}

export function IsValidOAuthRedirectUri(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidOAuthRedirectUri',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} harus berisi URI redirect OAuth yang valid (https, http, atau custom app scheme yang aman).`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (!Array.isArray(value)) return false;
          return value.every((item) => isValidOAuthRedirectUri(item));
        },
      },
    });
  };
}

export class CreatePortalTenantDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'acme-corp' })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  slug!: string;
}

export class UpdatePortalTenantDto {
  @ApiPropertyOptional({ example: 'Acme Holdings' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Slug bersifat immutable; mengirim field ini ditolak 400 TENANT_SLUG_IMMUTABLE',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
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
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: OAUTH_CLIENT_TYPES })
  @IsIn(OAUTH_CLIENT_TYPES)
  type!: PortalOAuthClientType;

  @ApiProperty({ example: ['https://acme.example.com/callback'] })
  @Transform(trimStringArray)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @IsValidOAuthRedirectUri()
  redirectUris!: string[];

  @ApiProperty({ example: ['openid', 'profile', 'email'] })
  @Transform(trimStringArray)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
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
