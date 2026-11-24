import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export interface UpdateAuthFeaturePatch {
  enabled?: boolean;
  settings?: Record<string, unknown>;
  secrets?: Record<string, string | null | undefined>;
  clearSecretKeys?: string[];
}

export class UpdateAuthConfigDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Peta konfigurasi fitur Better Auth per featureCode (settings, secrets, clearSecretKeys)',
  })
  @IsObject()
  features!: Record<string, UpdateAuthFeaturePatch>;
}
