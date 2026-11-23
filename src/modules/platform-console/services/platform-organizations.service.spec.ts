import { describe, expect, it, mock } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Organization } from '@/database/schema';
import type { IPlatformOrganizationRepository } from '../interfaces';
import { PlatformOrganizationsService } from './platform-organizations.service';

describe('PlatformOrganizationsService', () => {
  const actor = {
    id: 'usr_1',
    email: 'admin@authcore.io',
    role: 'super_admin',
  };

  const makeOrgRow = (overrides: Partial<Organization> = {}): Organization => ({
    id: 'org_1',
    tenantId: 'ten_1',
    name: 'Acme',
    slug: 'acme',
    logo: null,
    metadata: JSON.stringify({ ssoEnabled: true }),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  const createMocks = () => {
    const orgRepo: IPlatformOrganizationRepository = {
      listPaginated: mock(() => Promise.resolve({ items: [], total: 0 })),
      findById: mock(() => Promise.resolve(makeOrgRow())),
      findByTenantAndSlug: mock(() => Promise.resolve(null)),
      tenantExists: mock(() => Promise.resolve(true)),
      createWithOwner: mock((input) =>
        Promise.resolve(
          makeOrgRow({
            id: input.id,
            tenantId: input.tenantId,
            name: input.name,
            slug: input.slug,
            metadata: input.metadata,
          }),
        ),
      ),
      update: mock((_id, patch) => Promise.resolve(makeOrgRow(patch))),
      deleteById: mock(() => Promise.resolve(undefined)),
      getHydrationRelations: mock(() =>
        Promise.resolve({
          members: [],
          teams: [],
          invitations: [],
        }),
      ),
      createInvitation: mock(() => Promise.resolve(undefined)),
      updateMemberRole: mock(() => Promise.resolve(true)),
      removeMember: mock(() => Promise.resolve(true)),
      cancelInvitation: mock(() => Promise.resolve(true)),
    };

    const featureConfig = {
      assertFeatureEnabled: mock(() => undefined),
      isFeatureEnabled: mock(() => false),
    } as any;

    const auditService = {
      recordAudit: mock(() => Promise.resolve(undefined)),
    } as any;

    const emailService = {
      send: mock(() => Promise.resolve(undefined)),
    } as any;

    const configService = {
      get: mock((key: string) => {
        if (key === 'app') return { appName: 'Auth Core' };
        if (key === 'auth.clientUrl') return 'http://localhost:2000';
        return undefined;
      }),
    } as any;

    return {
      orgRepo,
      featureConfig,
      auditService,
      emailService,
      configService,
    };
  };

  it('should throw BadRequestException when tenantId is missing on createOrganization', async () => {
    const mocks = createMocks();
    const service = new PlatformOrganizationsService(
      mocks.orgRepo,
      mocks.featureConfig,
      mocks.auditService,
      mocks.emailService,
      mocks.configService,
    );

    await expect(
      service.createOrganization(
        { name: 'Acme', slug: 'acme', ssoEnabled: false },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException('tenantId diperlukan untuk membuat organisasi'),
    );
  });

  it('should throw BadRequestException when tenantId does not exist', async () => {
    const mocks = createMocks();
    (mocks.orgRepo.tenantExists as ReturnType<typeof mock>).mockResolvedValue(
      false,
    );

    const service = new PlatformOrganizationsService(
      mocks.orgRepo,
      mocks.featureConfig,
      mocks.auditService,
      mocks.emailService,
      mocks.configService,
    );

    await expect(
      service.createOrganization(
        {
          tenantId: 'ten_missing',
          name: 'Acme',
          slug: 'acme',
          ssoEnabled: false,
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw ConflictException when slug already exists in tenant', async () => {
    const mocks = createMocks();
    (
      mocks.orgRepo.findByTenantAndSlug as ReturnType<typeof mock>
    ).mockResolvedValue(makeOrgRow());

    const service = new PlatformOrganizationsService(
      mocks.orgRepo,
      mocks.featureConfig,
      mocks.auditService,
      mocks.emailService,
      mocks.configService,
    );

    await expect(
      service.createOrganization(
        { tenantId: 'ten_1', name: 'Acme', slug: 'acme', ssoEnabled: true },
        actor,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('should create organization without plan metadata and pass explicit tenantId', async () => {
    const mocks = createMocks();
    const service = new PlatformOrganizationsService(
      mocks.orgRepo,
      mocks.featureConfig,
      mocks.auditService,
      mocks.emailService,
      mocks.configService,
    );

    const org = await service.createOrganization(
      { tenantId: 'ten_1', name: 'Acme', slug: 'acme', ssoEnabled: true },
      actor,
    );

    const createdInput = (
      mocks.orgRepo.createWithOwner as ReturnType<typeof mock>
    ).mock.calls[0][0];
    expect(createdInput.tenantId).toBe('ten_1');
    expect(JSON.parse(createdInput.metadata)).toEqual({ ssoEnabled: true });
    expect('plan' in org).toBe(false);
  });

  it('should protect against IDOR when updating or removing members or cancelling invitations outside org', async () => {
    const mocks = createMocks();
    (
      mocks.orgRepo.updateMemberRole as ReturnType<typeof mock>
    ).mockResolvedValue(false);
    (mocks.orgRepo.removeMember as ReturnType<typeof mock>).mockResolvedValue(
      false,
    );
    (
      mocks.orgRepo.cancelInvitation as ReturnType<typeof mock>
    ).mockResolvedValue(false);

    const service = new PlatformOrganizationsService(
      mocks.orgRepo,
      mocks.featureConfig,
      mocks.auditService,
      mocks.emailService,
      mocks.configService,
    );

    await expect(
      service.updateOrganizationMemberRole('org_1', 'mem_other', {
        role: 'admin',
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.removeOrganizationMember('org_1', 'mem_other'),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.cancelOrganizationInvitation('org_1', 'inv_other'),
    ).rejects.toThrow(NotFoundException);
  });
});
