import type { Organization } from '@/database/schema';

export const PLATFORM_ORGANIZATION_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_ORGANIZATION_REPOSITORY_TOKEN',
);

export interface ListOrganizationsQuery {
  page: number;
  pageSize: number;
  search?: string;
}

export interface CreateOrgWithOwnerInput {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  metadata: string;
  ownerMemberId: string;
  ownerUserId: string;
  defaultTeamId: string;
}

export interface CreateInvitationRecord {
  id: string;
  tenantId: string;
  organizationId: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: Date;
  inviterId: string;
}

export interface OrgHydrationRelations {
  members: Array<{
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    name: string;
    email: string;
  }>;
  teams: Array<{
    id: string;
    name: string;
    memberCount: number;
    createdAt: Date;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: string | null;
    status: string;
    expiresAt: Date;
  }>;
}

export interface IPlatformOrganizationRepository {
  listPaginated(
    query: ListOrganizationsQuery,
  ): Promise<{ items: Organization[]; total: number }>;
  findById(id: string): Promise<Organization | null>;
  findByTenantAndSlug(
    tenantId: string,
    slug: string,
  ): Promise<Organization | null>;
  tenantExists(tenantId: string): Promise<boolean>;
  createWithOwner(input: CreateOrgWithOwnerInput): Promise<Organization>;
  update(id: string, patch: Partial<Organization>): Promise<Organization>;
  deleteById(id: string): Promise<void>;
  getHydrationRelations(orgId: string): Promise<OrgHydrationRelations>;
  createInvitation(input: CreateInvitationRecord): Promise<void>;
  updateMemberRole(
    orgId: string,
    memberId: string,
    role: string,
  ): Promise<boolean>;
  removeMember(orgId: string, memberId: string): Promise<boolean>;
  cancelInvitation(orgId: string, invitationId: string): Promise<boolean>;
}
