import { describe, expect, test } from 'bun:test';
import { buildInvitationLink } from './invitation-link.util';

describe('buildInvitationLink', () => {
  test('builds platform invite URL using /auth/accept-invitation?id=', () => {
    expect(
      buildInvitationLink({
        invitationId: 'inv-2',
        inviteURL: 'http://admin.test/accept-invite',
      }),
    ).toBe('http://admin.test/auth/accept-invitation?id=inv-2');
  });

  test('builds path-tenant invite URL using /t/<slug>/accept-invitation?id=', () => {
    expect(
      buildInvitationLink({
        invitationId: 'inv-3',
        inviteURL: 'http://localhost:3000/accept-invitation',
        baseUrl: 'http://localhost:2001',
        tenantContext: {
          tenantId: 'ten_pos',
          slug: 'pos-amir',
          source: 'path',
        },
      }),
    ).toBe('http://localhost:3000/t/pos-amir/accept-invitation?id=inv-3');
  });

  test('builds subdomain-tenant invite URL on tenant origin using /auth/accept-invitation?id=', () => {
    expect(
      buildInvitationLink({
        invitationId: 'inv-4',
        inviteURL: 'http://localhost:3000/accept-invitation',
        baseUrl: 'https://pos-amir.authcore.local',
        tenantContext: {
          tenantId: 'ten_pos',
          slug: 'pos-amir',
          source: 'subdomain',
        },
      }),
    ).toBe('https://pos-amir.authcore.local/auth/accept-invitation?id=inv-4');
  });
});
