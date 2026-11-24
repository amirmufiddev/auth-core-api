import { canCreateOrganization } from './organization-access';

describe('canCreateOrganization', () => {
  it('should allow a user with no memberships to create an organization', () => {
    expect(canCreateOrganization([])).toBe(true);
  });

  it('should allow a user who is owner of at least one organization', () => {
    expect(canCreateOrganization(['driver', 'owner'])).toBe(true);
    expect(canCreateOrganization(['owner'])).toBe(true);
  });

  it('should reject admin, driver, and member without an owner membership in platform context', () => {
    expect(canCreateOrganization(['admin'])).toBe(false);
    expect(canCreateOrganization(['driver'])).toBe(false);
    expect(canCreateOrganization(['member'])).toBe(false);
    expect(canCreateOrganization(['admin', 'driver'])).toBe(false);
    expect(canCreateOrganization(['member'], { tenantId: null })).toBe(false);
  });

  it('should allow a user with member role to create an organization in tenant context', () => {
    expect(canCreateOrganization(['member'], { tenantId: 'tenant-1' })).toBe(
      true,
    );
    expect(canCreateOrganization(['driver'], { tenantId: 'tenant-1' })).toBe(
      true,
    );
    expect(canCreateOrganization(['admin'], { tenantId: 'tenant-1' })).toBe(
      true,
    );
  });
});
