import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { AuthFeatureStatus } from '@/database/schema';

export class UpdateFeatureStatusDto {
  @ApiProperty({ enum: ['active', 'disabled', 'coming_soon'] })
  @IsIn(['active', 'disabled', 'coming_soon'])
  status!: AuthFeatureStatus;
}

export class UpdateTierFeaturesDto {
  @ApiProperty({
    type: [String],
    description: 'Daftar feature ID (UUID) atau feature code yang diizinkan pada tier ini',
  })
  @IsArray()
  @IsString({ each: true })
  features!: string[];
}

export class UpdateTenantFeatureConfigDto {
  @ApiProperty({ example: 'socialGoogle' })
  @IsString()
  featureCode!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { clientId: 'google-client-id' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Secret fields (e.g. clientSecret). Empty string preserves existing ciphertext.',
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string | null | undefined>;

  @ApiPropertyOptional({
    type: [String],
    description: 'Daftar key secret yang ingin dihapus secara eksplisit',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clearSecretKeys?: string[];
}
