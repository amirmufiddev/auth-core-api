import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { AuthCoreRoleRow } from '@/database/schema';
import type { IPlatformRoleRepository } from '../interfaces';

@Injectable()
export class PlatformRoleRepository implements IPlatformRoleRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listAll(): Promise<AuthCoreRoleRow[]> {
    return this.db
      .select()
      .from(schema.authCoreRole)
      .orderBy(asc(schema.authCoreRole.createdAt));
  }

  async findById(id: string): Promise<AuthCoreRoleRow | null> {
    const [found] = await this.db
      .select()
      .from(schema.authCoreRole)
      .where(eq(schema.authCoreRole.id, id))
      .limit(1);
    return found ?? null;
  }

  async findBySlug(slug: string): Promise<AuthCoreRoleRow | null> {
    const [found] = await this.db
      .select()
      .from(schema.authCoreRole)
      .where(eq(schema.authCoreRole.slug, slug))
      .limit(1);
    return found ?? null;
  }

  async create(input: {
    id: string;
    name: string;
    slug: string;
    description: string;
  }): Promise<AuthCoreRoleRow> {
    const [created] = await this.db
      .insert(schema.authCoreRole)
      .values({
        id: input.id,
        name: input.name,
        slug: input.slug,
        description: input.description,
        isSystem: false,
        permissions: {},
      })
      .returning();
    return created;
  }

  async update(
    id: string,
    patch: {
      name: string;
      description: string;
      permissions: Record<string, string[]>;
    },
  ): Promise<AuthCoreRoleRow> {
    const [updated] = await this.db
      .update(schema.authCoreRole)
      .set({
        name: patch.name,
        description: patch.description,
        permissions: patch.permissions,
        updatedAt: new Date(),
      })
      .where(eq(schema.authCoreRole.id, id))
      .returning();
    return updated;
  }

  async deleteById(id: string): Promise<void> {
    await this.db
      .delete(schema.authCoreRole)
      .where(eq(schema.authCoreRole.id, id));
  }
}
