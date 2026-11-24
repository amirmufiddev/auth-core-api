import { describe, expect, it } from 'bun:test';
import {
  BOOTSTRAP_BETTER_AUTH_STATEMENT,
  getBetterAuthStatement,
  getAllPermissionCodes,
  getDefaultRolePermissions,
  getDefaultPermissionScopes,
} from './permissions.constant';

describe('permissions.constant', () => {
  it('should define resources for the current tenant modules', () => {
    expect(Object.keys(BOOTSTRAP_BETTER_AUTH_STATEMENT).sort()).toEqual(
      [
        'ac',
        'apiKey',
        'billing',
        'feature',
        'invitation',
        'member',
        'oauthClient',
        'organization',
        'settings',
        'team',
        'user',
      ].sort(),
    );
    expect(BOOTSTRAP_BETTER_AUTH_STATEMENT).not.toHaveProperty('broadcast');
  });

  it('should generate Better Auth statement from actions', () => {
    const statement = getBetterAuthStatement();
    expect(statement.member).toContain('read');
    expect(statement.member).toContain('invite');
    expect(statement.organization).toContain('update');
    expect(statement.ac).toContain('create');
  });

  it('should list flat permission codes', () => {
    const codes = getAllPermissionCodes();
    expect(codes).toContain('ac:read');
    expect(codes).toContain('member:invite');
    expect(codes).toContain('feature:update');
    expect(codes).not.toContain('broadcast:trigger');
  });

  it('should define default admin role without removed domain permissions', () => {
    const roles = getDefaultRolePermissions();
    expect(roles.admin.member).toContain('invite');
    expect(roles.admin.organization).not.toContain('delete');
    expect(roles.owner.organization).toContain('delete');
    expect(roles.admin).not.toHaveProperty('broadcast');
  });

  it('should define permission scopes for admin and member', () => {
    const scopes = getDefaultPermissionScopes();
    expect(scopes.admin['member:read']).toBe('organization');
    expect(scopes.member['member:read']).toBe('organization');
  });
});
