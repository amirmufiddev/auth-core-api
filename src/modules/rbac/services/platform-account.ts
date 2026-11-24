import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/database/schema';

export async function assertPlatformAccount(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  deniedMessage: string,
): Promise<{ id: string; role: string | null; tenantId: null }> {
  const [row] = await db
    .select({
      id: schema.user.id,
      role: schema.user.role,
      tenantId: schema.user.tenantId,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!row || row.tenantId !== null) {
    throw new ForbiddenException(deniedMessage);
  }

  return { id: row.id, role: row.role, tenantId: null };
}