import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type {
  ITenantContextRepository,
  TenantApiKeyRecord,
  TenantOrganizationMemberSummary,
  TenantOrganizationSummary,
} from '../interfaces/tenant-context-repository.interface';

@Injectable()
export class TenantContextRepository implements ITenantContextRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findTenantStatus(
    tenantId: string,
  ): Promise<'active' | 'suspended' | null> {
    const [row] = await this.db
      .select({ status: schema.tenant.status })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId))
      .limit(1);
    if (!row) return null;
    return row.status === 'suspended' ? 'suspended' : 'active';
  }

  async findUserTenantId(
    userId: string,
  ): Promise<{ tenantId: string | null; banned?: boolean | null } | null> {
    const [row] = await this.db
      .select({
        tenantId: schema.user.tenantId,
        banned: schema.user.banned,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    return row ?? null;
  }

  async findOrganizationById(
    organizationId: string,
  ): Promise<TenantOrganizationSummary | null> {
    const [row] = await this.db
      .select({
        id: schema.organization.id,
        tenantId: schema.organization.tenantId,
        name: schema.organization.name,
        slug: schema.organization.slug,
        logo: schema.organization.logo,
        createdAt: schema.organization.createdAt,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    return row ?? null;
  }

  async findMemberInOrganization(
    organizationId: string,
    userId: string,
  ): Promise<{ role: string; tenantId: string | null } | null> {
    const [row] = await this.db
      .select({
        role: schema.member.role,
        tenantId: schema.member.tenantId,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findOrganizationRolePermissions(
    organizationId: string,
    role: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ permission: schema.organizationRole.permission })
      .from(schema.organizationRole)
      .where(
        and(
          eq(schema.organizationRole.organizationId, organizationId),
          eq(schema.organizationRole.role, role),
        ),
      )
      .limit(1);
    return row?.permission ?? null;
  }

  async findApiKeyByHashedKey(
    hashedKey: string,
  ): Promise<TenantApiKeyRecord | null> {
    const [row] = await this.db
      .select({
        id: schema.apikey.id,
        tenantId: schema.apikey.tenantId,
        referenceId: schema.apikey.referenceId,
        key: schema.apikey.key,
        enabled: schema.apikey.enabled,
        expiresAt: schema.apikey.expiresAt,
      })
      .from(schema.apikey)
      .where(eq(schema.apikey.key, hashedKey))
      .limit(1);
    return row ?? null;
  }

  async listOrganizationsForTenant(params: {
    tenantId: string;
    userId?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: TenantOrganizationSummary[]; total: number }> {
    const conditions = [eq(schema.organization.tenantId, params.tenantId)];

    if (params.userId) {
      const memberOrgs = await this.db
        .select({ organizationId: schema.member.organizationId })
        .from(schema.member)
        .where(eq(schema.member.userId, params.userId));
      const orgIds = memberOrgs.map((m) => m.organizationId);
      if (orgIds.length === 0) {
        return { items: [], total: 0 };
      }
      conditions.push(inArray(schema.organization.id, orgIds));
    }

    if (params.search?.trim()) {
      const pattern = `%${params.search.trim()}%`;
      const searchCond = or(
        ilike(schema.organization.name, pattern),
        ilike(schema.organization.slug, pattern),
      );
      if (searchCond) conditions.push(searchCond);
    }

    const whereClause = and(...conditions);

    const [items, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.organization.id,
          tenantId: schema.organization.tenantId,
          name: schema.organization.name,
          slug: schema.organization.slug,
          logo: schema.organization.logo,
          createdAt: schema.organization.createdAt,
        })
        .from(schema.organization)
        .where(whereClause)
        .orderBy(desc(schema.organization.createdAt))
        .limit(params.limit)
        .offset(params.offset),
      this.db
        .select({ total: count() })
        .from(schema.organization)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async listOrganizationMembers(params: {
    organizationId: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: TenantOrganizationMemberSummary[]; total: number }> {
    const conditions = [
      eq(schema.member.organizationId, params.organizationId),
    ];

    if (params.search?.trim()) {
      const pattern = `%${params.search.trim()}%`;
      const searchCond = or(
        ilike(schema.user.name, pattern),
        ilike(schema.user.email, pattern),
        ilike(schema.member.role, pattern),
      );
      if (searchCond) conditions.push(searchCond);
    }

    const whereClause = and(...conditions);

    const [items, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.member.id,
          userId: schema.member.userId,
          role: schema.member.role,
          createdAt: schema.member.createdAt,
          userName: schema.user.name,
          userEmail: schema.user.email,
        })
        .from(schema.member)
        .leftJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(whereClause)
        .orderBy(desc(schema.member.createdAt))
        .limit(params.limit)
        .offset(params.offset),
      this.db
        .select({ total: count() })
        .from(schema.member)
        .leftJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
    };
  }
}
