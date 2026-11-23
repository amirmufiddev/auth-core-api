import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateAuthConfigDto {
  @IsObject()
  features!: Record<
    string,
    { enabled?: boolean; settings?: Record<string, unknown> }
  >;
}

export class CreateConsoleUserDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  role!: string;

  @IsBoolean()
  emailVerified!: boolean;

  @IsBoolean()
  twoFactorEnabled!: boolean;

  @IsOptional()
  @IsString()
  organizationName?: string;
}

export class UpdateConsoleUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @IsOptional()
  @IsString()
  organizationName?: string;
}

export class BanConsoleUserDto {
  @IsBoolean()
  banned!: boolean;

  @IsOptional()
  @IsString()
  banReason?: string;

  @IsOptional()
  @IsString()
  banExpires?: string;
}

export class CreateConsoleRoleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  slug!: string;

  @IsString()
  description!: string;
}

export class UpdateConsoleRoleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  description!: string;

  @IsObject()
  permissions!: Record<string, string[]>;
}

export class CreateConsoleOrgDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  slug!: string;

  @IsBoolean()
  ssoEnabled!: boolean;
}

export class UpdateConsoleOrgDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsBoolean()
  ssoEnabled?: boolean;
}

export class InviteOrgMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}

export class UpdateOrgMemberRoleDto {
  @IsIn(['owner', 'admin', 'member'])
  role!: 'owner' | 'admin' | 'member';
}

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  prefix!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @IsInt()
  @Min(1)
  rateLimitMax!: number;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class ToggleApiKeyDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CreateOAuthClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(['oidc-confidential', 'oidc-public', 'mcp-client'])
  type!: 'oidc-confidential' | 'oidc-public' | 'mcp-client';

  @IsArray()
  @IsString({ each: true })
  redirectUris!: string[];

  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @IsBoolean()
  pkceRequired!: boolean;
}

export class CreateSsoProviderDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(['saml2', 'oidc'])
  protocol!: 'saml2' | 'oidc';

  @IsString()
  @MinLength(1)
  domain!: string;

  @IsString()
  organizationName!: string;

  @IsBoolean()
  scimEnabled!: boolean;
}
