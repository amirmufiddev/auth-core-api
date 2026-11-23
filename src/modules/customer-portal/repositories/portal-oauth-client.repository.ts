import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { BusinessError } from '@/common/errors/business-error';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  CreatePortalOAuthClientRecord,
  IPortalOAuthClientRepository,
  ListTenantOAuthClientsQuery,
  PortalOAuthClientRow,
} from '../interfaces/portal-oauth-client-repository.interface';

@Injectable()
export class PortalOAuthClientRepository implements IPortalOAuthClientRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listByTenantPaginated(
    query: ListTenantOAuthClientsQuery,
  ): Promise<{ items: PortalOAuthClientRow[]; total: number }> {
    const conditions: SQL[] = [eq(schema.oauthClient.tenantId, query.tenantId)];
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

    const whereClause = and(...conditions);
    const { pageSize, offset } = clampZeroBasedPagination(
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

  async createWithQuotaCheck(
    input: CreatePortalOAuthClientRecord,
    maxClients?: number,
  ): Promise<PortalOAuthClientRow> {
    return this.db.transaction(async (tx) => {
      if (maxClients !== undefined) {
        const [lockedTenant] = await tx
          .select({ id: schema.tenant.id })
          .from(schema.tenant)
          .where(eq(schema.tenant.id, input.tenantId))
          .for('update');

        if (!lockedTenant) {
          throw BusinessError.notFound('Tenant', input.tenantId);
        }

        const [row] = await tx
          .select({ total: count() })
          .from(schema.oauthClient)
          .where(eq(schema.oauthClient.tenantId, input.tenantId));

        const currentCount = Number(row?.total ?? 0);
        if (currentCount >= maxClients) {
          throw BusinessError.forbidden(
            'Tier Free hanya mengizinkan maksimal 1 OAuth client per tenant.',
            'TIER_CLIENT_LIMIT_REACHED',
            {
              tenantId: input.tenantId,
              limit: maxClients,
            },
          );
        }
      }

      const [created] = await tx
        .insert(schema.oauthClient)
        .values({
          id: input.id,
          tenantId: input.tenantId,
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
    });
  }

  async deleteByTenantAndId(tenantId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.oauthClient)
      .where(
        and(
          eq(schema.oauthClient.tenantId, tenantId),
          eq(schema.oauthClient.id, id),
        ),
      )
      .returning({ id: schema.oauthClient.id });

    return deleted.length > 0;
  }
}
