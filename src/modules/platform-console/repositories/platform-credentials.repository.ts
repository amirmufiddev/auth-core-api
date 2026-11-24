import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { ApiKey } from '@/database/schema';
import { normalizePagination } from '../dto/pagination.util';
import type {
  ApiKeyWithOwnerRow,
  CreateOAuthClientRecord,
  CreateSsoProviderRecord,
  IPlatformApiKeyRepository,
  IPlatformOAuthClientRepository,
  IPlatformSsoProviderRepository,
  OAuthClientRow,
  PaginatedSearchQuery,
  SsoProviderRow,
  SsoProviderWithOrgRow,
} from '../interfaces';

@Injectable()
export class PlatformApiKeyRepository implements IPlatformApiKeyRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listPaginated(
    query: PaginatedSearchQuery,
  ): Promise<{ items: ApiKeyWithOwnerRow[]; total: number }> {
    const conditions: SQL[] = [isNull(schema.apikey.tenantId)];
    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.apikey.name, pattern),
          ilike(schema.apikey.prefix, pattern),
          ilike(schema.user.email, pattern),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const { pageSize, offset } = normalizePagination(
      query.page,
      query.pageSize,
    );

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          apiKey: schema.apikey,
          ownerEmail: schema.user.email,
        })
        .from(schema.apikey)
        .leftJoin(schema.user, eq(schema.apikey.referenceId, schema.user.id))
        .where(whereClause)
        .orderBy(desc(schema.apikey.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.apikey)
        .leftJoin(schema.user, eq(schema.apikey.referenceId, schema.user.id))
        .where(whereClause),
    ]);

    return {
      items: rows,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findById(id: string): Promise<ApiKey | null> {
    const [found] = await this.db
      .select()
      .from(schema.apikey)
      .where(and(eq(schema.apikey.id, id), isNull(schema.apikey.tenantId)))
      .limit(1);
    return found ?? null;
  }

  async updateEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db
      .update(schema.apikey)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(schema.apikey.id, id), isNull(schema.apikey.tenantId)));
  }

  async deleteById(id: string): Promise<void> {
    await this.db
      .delete(schema.apikey)
      .where(and(eq(schema.apikey.id, id), isNull(schema.apikey.tenantId)));
  }
}

@Injectable()
export class PlatformOAuthClientRepository implements IPlatformOAuthClientRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listPaginated(
    query: PaginatedSearchQuery,
  ): Promise<{ items: OAuthClientRow[]; total: number }> {
    const conditions: SQL[] = [isNull(schema.oauthClient.tenantId)];
    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.oauthClient.name, pattern),
          ilike(schema.oauthClient.clientId, pattern),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const { pageSize, offset } = normalizePagination(
      query.page,
      query.pageSize,
    );

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.oauthClient)
        .where(whereClause)
        .orderBy(desc(schema.oauthClient.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.oauthClient)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async create(input: CreateOAuthClientRecord): Promise<OAuthClientRow> {
    const [created] = await this.db
      .insert(schema.oauthClient)
      .values({
        id: input.id,
        tenantId: null,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        name: input.name,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        requirePKCE: input.requirePKCE,
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
        applicationType: input.applicationType,
        disabled: false,
        userId: input.userId,
        metadata: input.metadata,
      })
      .returning();
    return created;
  }

  async deleteById(id: string): Promise<void> {
    await this.db
      .delete(schema.oauthClient)
      .where(
        and(eq(schema.oauthClient.id, id), isNull(schema.oauthClient.tenantId)),
      );
  }
}

@Injectable()
export class PlatformSsoProviderRepository implements IPlatformSsoProviderRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listAllWithOrgNames(): Promise<SsoProviderWithOrgRow[]> {
    return this.db
      .select({
        provider: schema.ssoProvider,
        organizationName: schema.organization.name,
      })
      .from(schema.ssoProvider)
      .leftJoin(
        schema.organization,
        eq(schema.ssoProvider.organizationId, schema.organization.id),
      )
      .where(isNull(schema.ssoProvider.tenantId))
      .orderBy(desc(schema.ssoProvider.createdAt));
  }

  async create(input: CreateSsoProviderRecord): Promise<SsoProviderRow> {
    const [created] = await this.db
      .insert(schema.ssoProvider)
      .values({
        id: input.id,
        tenantId: null,
        providerId: input.providerId,
        issuer: input.issuer,
        domain: input.domain,
        domainVerified: false,
        userId: input.userId,
        samlConfig: input.samlConfig,
        oidcConfig: input.oidcConfig,
      })
      .returning();
    return created;
  }

  async deleteById(id: string): Promise<void> {
    await this.db
      .delete(schema.ssoProvider)
      .where(
        and(eq(schema.ssoProvider.id, id), isNull(schema.ssoProvider.tenantId)),
      );
  }
}
