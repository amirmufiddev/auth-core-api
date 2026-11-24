import { RlsContext } from './rls-context';

describe('RlsContext', () => {
  it('should report no store outside run()', () => {
    expect(RlsContext.hasStore()).toBe(false);
    expect(RlsContext.getCurrentTenantId()).toBeNull();
    expect(RlsContext.getCurrentOrganizationId()).toBeNull();
  });

  it('should keep a platform store distinct from a missing store', () => {
    RlsContext.run({ tenantId: null, organizationId: null }, () => {
      expect(RlsContext.hasStore()).toBe(true);
      expect(RlsContext.getCurrentTenantId()).toBeNull();
      expect(RlsContext.getCurrentOrganizationId()).toBeNull();
    });
    expect(RlsContext.hasStore()).toBe(false);
  });

  it('should return both ids inside run()', () => {
    RlsContext.run(
      { tenantId: 'ten_1', organizationId: 'org_1' },
      () => {
        expect(RlsContext.getCurrentTenantId()).toBe('ten_1');
        expect(RlsContext.getCurrentOrganizationId()).toBe('org_1');
      },
    );
  });

  it('should restore the outer store after a nested run()', () => {
    RlsContext.run({ tenantId: 'ten_outer', organizationId: 'org_outer' }, () => {
      RlsContext.run(
        { tenantId: null, organizationId: 'org_inner' },
        () => {
          expect(RlsContext.getCurrentTenantId()).toBeNull();
          expect(RlsContext.getCurrentOrganizationId()).toBe('org_inner');
        },
      );
      expect(RlsContext.getCurrentTenantId()).toBe('ten_outer');
      expect(RlsContext.getCurrentOrganizationId()).toBe('org_outer');
    });
  });
});