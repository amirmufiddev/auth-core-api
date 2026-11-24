import type { User } from '@/database/schema';

export function mapPlatformUserRecord(
  u: User,
  passkeyCount = 0,
  organizationName = 'Auth Core HQ',
) {
  return {
    id: u.id,
    tenantId: u.tenantId ?? null,
    name: u.name,
    email: u.email,
    username: u.username ?? undefined,
    phoneNumber: u.phoneNumber ?? undefined,
    role: u.role ?? 'user',
    emailVerified: u.emailVerified,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    passkeyCount,
    banned: Boolean(u.banned),
    banReason: u.banReason ?? undefined,
    banExpires: u.banExpires ? u.banExpires.toISOString() : undefined,
    image: u.image ?? undefined,
    organizationName,
    lastLoginMethod: u.lastLoginMethod ?? 'email',
    lastActiveAt: u.updatedAt.toISOString(),
    createdAt: u.createdAt.toISOString(),
  };
}
