import type { ResolvedTenantContext } from '@/modules/tenant';

function safeOrigin(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
}

export function buildInvitationLink(input: {
  invitationId: string;
  inviteURL?: string;
  baseUrl?: string;
  tenantContext?: Pick<
    ResolvedTenantContext,
    'tenantId' | 'slug' | 'source'
  > | null;
}): string {
  const encodedId = encodeURIComponent(input.invitationId);
  const ctx = input.tenantContext;
  const path =
    ctx?.source === 'path' && ctx.slug
      ? `/t/${ctx.slug}/accept-invitation?id=${encodedId}`
      : `/auth/accept-invitation?id=${encodedId}`;

  const origin =
    ctx?.source === 'subdomain'
      ? safeOrigin(input.baseUrl) || safeOrigin(input.inviteURL)
      : safeOrigin(input.inviteURL) || safeOrigin(input.baseUrl);

  return origin ? `${origin}${path}` : path;
}
