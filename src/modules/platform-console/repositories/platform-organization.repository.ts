import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { Organization } from '@/database/schema';
import type {
  CreateInvitationRecord,
  CreateOrgWithOwnerInput,
  IPlatformOrganizationRepository,
  ListOrganizationsQuery,
  OrgHydrationRelations,
} from '../interfaces';

@Injectable()
export class PlatformOrganizationRepository implements IPlatformOrganizationRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listPaginated(
    query: ListOrganizationsQuery,
  ): Promise<{ items: Organization[]; total: number }> {
    const conditions: SQL[] = [];
    const trimmedSearch = query.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      conditions.push(
        or(
          ilike(schema.organization.name, pattern),
          ilike(schema.organization.slug, pattern),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = Math.max(0, query.page) * Math.max(1, query.pageSize);

    const [items, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.organization)
        .where(whereClause)
        .orderBy(desc(schema.organization.createdAt))
        .limit(query.pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.organization)
        .where(whereClause),
    ]);

    return {
      items,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findById(id: string): Promise<Organization | null> {
    const [found] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, id))
      .limit(1);
    return found ?? null;
  }

  async findByTenantAndSlug(
    tenantId: string,
    slug: string,
  ): Promise<Organization | null> {
    const [found] = await this.db
      .select()
      .from(schema.organization)
      .where(
        and(
          eq(schema.organization.tenantId, tenantId),
          eq(schema.organization.slug, slug),
        ),
      )
      .limit(1);
    return found ?? null;
  }

  async tenantExists(tenantId: string): Promise<boolean> {
    const [found] = await this.db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId))
      .limit(1);
    return Boolean(found);
  }

  async createWithOwner(input: CreateOrgWithOwnerInput): Promise<Organization> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.organization)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          name: input.name,
          slug: input.slug,
          metadata: input.metadata,
        })
        .returning();

      await tx.insert(schema.member).values({
        id: input.ownerMemberId,
        tenantId: input.tenantId,
        organizationId: input.id,
        userId: input.ownerUserId,
        role: 'owner',
      });

      await tx.insert(schema.team).values({
        id: input.defaultTeamId,
        name: 'General',
        memberCount: 1,
        organizationId: input.id,
      });

      return created;
    });
  }

  async update(
    id: string,
    patch: Partial<Organization>,
  ): Promise<Organization> {
    const [updated] = await this.db
      .update(schema.organization)
      .set(patch)
      .where(eq(schema.organization.id, id))
      .returning();
    return updated;
  }

  async deleteById(id: string): Promise<void> {
    await this.db
      .delete(schema.organization)
      .where(eq(schema.organization.id, id));
  }

  async getHydrationRelations(orgId: string): Promise<OrgHydrationRelations> {
    const [members, teams, invitations] = await Promise.all([
      this.db
        .select({
          id: schema.member.id,
          userId: schema.member.userId,
          role: schema.member.role,
          createdAt: schema.member.createdAt,
          name: schema.user.name,
          email: schema.user.email,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(eq(schema.member.organizationId, orgId)),
      this.db
        .select({
          id: schema.team.id,
          name: schema.team.name,
          memberCount: schema.team.memberCount,
          createdAt: schema.team.createdAt,
        })
        .from(schema.team)
        .where(eq(schema.team.organizationId, orgId)),
      this.db
        .select({
          id: schema.invitation.id,
          email: schema.invitation.email,
          role: schema.invitation.role,
          status: schema.invitation.status,
          expiresAt: schema.invitation.expiresAt,
        })
        .from(schema.invitation)
        .where(eq(schema.invitation.organizationId, orgId)),
    ]);

    return { members, teams, invitations };
  }

  async createInvitation(input: CreateInvitationRecord): Promise<void> {
    await this.db.insert(schema.invitation).values({
      id: input.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
      status: 'pending',
      expiresAt: input.expiresAt,
      inviterId: input.inviterId,
    });
  }

  async updateMemberRole(
    orgId: string,
    memberId: string,
    role: string,
  ): Promise<boolean> {
    const updated = await this.db
      .update(schema.member)
      .set({ role })
      .where(
        and(
          eq(schema.member.organizationId, orgId),
          eq(schema.member.id, memberId),
        ),
      )
      .returning({ id: schema.member.id });
    return updated.length > 0;
  }

  async removeMember(orgId: string, memberId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, orgId),
          eq(schema.member.id, memberId),
        ),
      )
      .returning({ id: schema.member.id });
    return deleted.length > 0;
  }

  async cancelInvitation(
    orgId: string,
    invitationId: string,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, orgId),
          eq(schema.invitation.id, invitationId),
        ),
      )
      .returning({ id: schema.invitation.id });
    return deleted.length > 0;
  }
}
