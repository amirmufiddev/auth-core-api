import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import {
  NewOrganizationRoleTemplate,
  OrganizationRoleTemplate,
} from '@/database/schema';

@Injectable()
export class RbacRoleTemplateRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByTenant(tenantId: string): Promise<OrganizationRoleTemplate[]> {
    return this.db
      .select()
      .from(schema.organizationRoleTemplate)
      .where(eq(schema.organizationRoleTemplate.tenantId, tenantId));
  }

  async findByTenantAndRole(
    tenantId: string,
    roleName: string,
  ): Promise<OrganizationRoleTemplate | undefined> {
    const rows = await this.db
      .select()
      .from(schema.organizationRoleTemplate)
      .where(
        and(
          eq(schema.organizationRoleTemplate.tenantId, tenantId),
          eq(schema.organizationRoleTemplate.roleName, roleName),
        ),
      )
      .limit(1);

    return rows[0];
  }

  async create(
    data: NewOrganizationRoleTemplate,
  ): Promise<OrganizationRoleTemplate> {
    const rows = await this.db
      .insert(schema.organizationRoleTemplate)
      .values(data)
      .returning();
    return rows[0];
  }

  async update(
    tenantId: string,
    roleName: string,
    data: Partial<
      Pick<OrganizationRoleTemplate, 'permission' | 'permissionScopes'>
    >,
  ): Promise<OrganizationRoleTemplate | undefined> {
    const rows = await this.db
      .update(schema.organizationRoleTemplate)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(schema.organizationRoleTemplate.tenantId, tenantId),
          eq(schema.organizationRoleTemplate.roleName, roleName),
        ),
      )
      .returning();

    return rows[0];
  }

  async delete(tenantId: string, roleName: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.organizationRoleTemplate)
      .where(
        and(
          eq(schema.organizationRoleTemplate.tenantId, tenantId),
          eq(schema.organizationRoleTemplate.roleName, roleName),
        ),
      )
      .returning({ roleName: schema.organizationRoleTemplate.roleName });

    return rows.length > 0;
  }
}
