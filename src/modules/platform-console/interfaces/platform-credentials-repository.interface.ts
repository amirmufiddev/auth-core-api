import type { ApiKey } from '@/database/schema';
import type * as schema from '@/database/schema';

export type OAuthClientRow = typeof schema.oauthClient.$inferSelect;
export type SsoProviderRow = typeof schema.ssoProvider.$inferSelect;

export const PLATFORM_API_KEY_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_API_KEY_REPOSITORY_TOKEN',
);
export const PLATFORM_OAUTH_CLIENT_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_OAUTH_CLIENT_REPOSITORY_TOKEN',
);
export const PLATFORM_SSO_PROVIDER_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_SSO_PROVIDER_REPOSITORY_TOKEN',
);

export interface PaginatedSearchQuery {
  page: number;
  pageSize: number;
  search?: string;
}

export interface ApiKeyWithOwnerRow {
  apiKey: ApiKey;
  ownerEmail: string | null;
}

export interface CreateOAuthClientRecord {
  id: string;
  clientId: string;
  clientSecret: string | null;
  name: string;
  redirectUris: string[];
  scopes: string[];
  requirePKCE: boolean;
  tokenEndpointAuthMethod: string;
  applicationType: string;
  userId: string;
  metadata: Record<string, unknown>;
}

export interface SsoProviderWithOrgRow {
  provider: SsoProviderRow;
  organizationName: string | null;
}

export interface CreateSsoProviderRecord {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  userId: string;
  samlConfig: string | null;
  oidcConfig: string | null;
}

export interface IPlatformApiKeyRepository {
  listPaginated(
    query: PaginatedSearchQuery,
  ): Promise<{ items: ApiKeyWithOwnerRow[]; total: number }>;
  findById(id: string): Promise<ApiKey | null>;
  updateEnabled(id: string, enabled: boolean): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export interface IPlatformOAuthClientRepository {
  listPaginated(
    query: PaginatedSearchQuery,
  ): Promise<{ items: OAuthClientRow[]; total: number }>;
  create(input: CreateOAuthClientRecord): Promise<OAuthClientRow>;
  deleteById(id: string): Promise<void>;
}

export interface IPlatformSsoProviderRepository {
  listAllWithOrgNames(): Promise<SsoProviderWithOrgRow[]>;
  create(input: CreateSsoProviderRecord): Promise<SsoProviderRow>;
  deleteById(id: string): Promise<void>;
}
