import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import {
  NewOrganizationPermission,
  OrganizationPermission,
} from '@/database/schema';
import { BaseRepository } from '@/common/repository/base.repository';
import type { IRbacPermissionRepository } from '../interfaces/rbac-permission-repository.interface';

@Injectable()
export class RbacPermissionRepository
  extends BaseRepository<typeof schema.organizationPermission>
  implements IRbacPermissionRepository
{
  constructor(@Inject(DRIZZLE) db: NodePgDatabase) {
    super(db, schema.organizationPermission);
  }

  async findAllActiveByTenant(
    tenantId: string,
  ): Promise<OrganizationPermission[]> {
    return this.findAll({
      where: eq(schema.organizationPermission.tenantId, tenantId),
      orderBy: undefined,
    });
  }

  async findByResourceAndAction(
    tenantId: string,
    resource: string,
    action: string,
  ): Promise<OrganizationPermission | undefined> {
    const rows = await this.db
      .select()
      .from(schema.organizationPermission)
      .where(
        and(
          eq(schema.organizationPermission.tenantId, tenantId),
          eq(schema.organizationPermission.resource, resource),
          eq(schema.organizationPermission.action, action),
          isNull(schema.organizationPermission.deletedAt),
        ),
      )
      .limit(1);

    return rows[0];
  }

  async findActiveById(
    tenantId: string,
    id: string,
  ): Promise<OrganizationPermission | undefined> {
    const rows = await this.db
      .select()
      .from(schema.organizationPermission)
      .where(
        and(
          eq(schema.organizationPermission.id, id),
          eq(schema.organizationPermission.tenantId, tenantId),
          isNull(schema.organizationPermission.deletedAt),
        ),
      )
      .limit(1);

    return rows[0];
  }

  async createPermission(
    data: NewOrganizationPermission,
  ): Promise<OrganizationPermission> {
    const result = await this.db
      .insert(schema.organizationPermission)
      .values({
        ...data,
        updatedAt: new Date(),
      })
      .returning();

    return result[0];
  }

  async updatePermission(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<
        OrganizationPermission,
        | 'actionDisplayName'
        | 'actionDescription'
        | 'resourceDisplayName'
        | 'resourceDescription'
      >
    >,
  ): Promise<OrganizationPermission | undefined> {
    const result = await this.db
      .update(schema.organizationPermission)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.organizationPermission.id, id),
          eq(schema.organizationPermission.tenantId, tenantId),
          isNull(schema.organizationPermission.deletedAt),
        ),
      )
      .returning();

    return result[0];
  }

  async softDeleteForTenant(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .update(schema.organizationPermission)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.organizationPermission.id, id),
          eq(schema.organizationPermission.tenantId, tenantId),
          isNull(schema.organizationPermission.deletedAt),
        ),
      )
      .returning({ id: schema.organizationPermission.id });

    return result.length > 0;
  }
}
