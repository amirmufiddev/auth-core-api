import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertOrganizationRoleTemplateDto {
  @ApiProperty({ example: 'cashier' })
  @IsString()
  @MaxLength(64)
  roleName!: string;

  @ApiProperty({
    example: { member: ['read'] },
  })
  @IsObject()
  permission!: Record<string, string[]>;

  @ApiPropertyOptional({
    example: { 'member:read': 'organization' },
  })
  @IsOptional()
  @IsObject()
  permissionScopes?: Record<string, string>;
}
