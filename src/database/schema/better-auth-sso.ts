import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { user } from './better-auth-user';
import { tenant } from './tenant';
import {
  tenantIdNotBlank,
  tenantScopeColumn,
  userTenantScopeFk,
} from './tenant-scope';

export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenant.id, {
      onDelete: 'restrict',
    }),
    tenantScope: tenantScopeColumn(),
    issuer: text('issuer').notNull(),
    oidcConfig: text('oidc_config'),
    samlConfig: text('saml_config'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull().unique(),
    organizationId: text('organization_id'),
    domain: text('domain').notNull(),
    domainVerified: boolean('domain_verified').default(false),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_sso_provider_tenant_id').on(table.tenantId),
    index('idx_sso_provider_domain').on(table.domain),
    index('idx_sso_provider_org_id').on(table.organizationId),
    tenantIdNotBlank('ck_sso_provider_tenant_id_not_blank', table.tenantId),
    userTenantScopeFk(
      'fk_sso_provider_user_tenant_scope',
      table.userId,
      table.tenantScope,
      user.id,
      user.tenantScope,
    ),
  ],
);

export const scimManagedConnection = pgTable('scim_managed_connection', {
  id: text('id').primaryKey(),
  creationRequestId: text('creation_request_id').notNull().unique(),
  connectionId: text('connection_id').notNull().unique(),
  provisioningDomainId: text('provisioning_domain_id').notNull(),
  status: text('status').notNull(),
  revision: integer('revision').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by').notNull(),
  decommissionStartedAt: timestamp('decommission_started_at'),
  decommissionStartedBy: text('decommission_started_by'),
  decommissionedAt: timestamp('decommissioned_at'),
  decommissionedBy: text('decommissioned_by'),
});

export const scimManagedCredential = pgTable('scim_managed_credential', {
  id: text('id').primaryKey(),
  connectionRecordId: text('connection_record_id')
    .notNull()
    .references(() => scimManagedConnection.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  tokenDigest: text('token_digest').notNull(),
  hashVersion: text('hash_version').notNull(),
  activeSlotKey: text('active_slot_key').notNull().unique(),
  status: text('status').notNull(),
  serializedScopes: text('serialized_scopes').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  revokedBy: text('revoked_by'),
  decommissionedAt: timestamp('decommissioned_at'),
});

export const scimManagedConnectionEvent = pgTable(
  'scim_managed_connection_event',
  {
    id: text('id').primaryKey(),
    connectionRecordId: text('connection_record_id')
      .notNull()
      .references(() => scimManagedConnection.id, { onDelete: 'cascade' }),
    eventKey: text('event_key').notNull().unique(),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    actorId: text('actor_id').notNull(),
    credentialId: text('credential_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
);

export const scimConnectionBinding = pgTable('scim_connection_binding', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  connectionKey: text('connection_key').notNull().unique(),
  provisioningDomainId: text('provisioning_domain_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  decommissionedAt: timestamp('decommissioned_at'),
  decommissionStatus: text('decommission_status').notNull(),
  decommissionCursorUserId: text('decommission_cursor_user_id'),
  decommissionReconciledUserCount: integer(
    'decommission_reconciled_user_count',
  ).notNull(),
  decommissionBatchCount: integer('decommission_batch_count').notNull(),
  decommissionRevision: integer('decommission_revision').notNull(),
  decommissionCompletedAt: timestamp('decommission_completed_at'),
  decommissionLeaseId: text('decommission_lease_id'),
  decommissionLeaseExpiresAt: timestamp('decommission_lease_expires_at'),
});

export const scimIdentityTombstone = pgTable('scim_identity_tombstone', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  provisioningDomainId: text('provisioning_domain_id').notNull(),
  externalId: text('external_id').notNull(),
  externalIdKey: text('external_id_key').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  profile: text('profile').notNull(),
  deletedAt: timestamp('deleted_at').notNull(),
});

export const scimSubject = pgTable('scim_subject', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  profileSourceId: text('profile_source_id'),
  revision: integer('revision').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const scimUser = pgTable('scim_user', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  provisioningDomainId: text('provisioning_domain_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  connectionUserKey: text('connection_user_key').notNull().unique(),
  userName: text('user_name').notNull(),
  userNameKey: text('user_name_key').notNull().unique(),
  primaryEmail: text('primary_email').notNull(),
  workEmailValueIndex: text('work_email_value_index').notNull(),
  emailValueIndex: text('email_value_index').notNull(),
  displayName: text('display_name').notNull(),
  formattedName: text('formatted_name').notNull(),
  givenName: text('given_name'),
  familyName: text('family_name'),
  serializedEmails: text('serialized_emails').notNull(),
  serializedAttributes: text('serialized_attributes'),
  externalId: text('external_id'),
  externalIdKey: text('external_id_key').unique(),
  active: boolean('active').notNull(),
  orderKey: text('order_key').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const scimProjectionGrant = pgTable('scim_projection_grant', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  provisioningDomainId: text('provisioning_domain_id').notNull(),
  scimUserId: text('scim_user_id')
    .notNull()
    .references(() => scimUser.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceValue: text('source_value'),
  role: text('role').notNull(),
  grantKey: text('grant_key').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const scimGroup = pgTable('scim_group', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  provisioningDomainId: text('provisioning_domain_id').notNull(),
  revision: integer('revision').notNull(),
  displayName: text('display_name').notNull(),
  displayNameKey: text('display_name_key').notNull().unique(),
  externalId: text('external_id'),
  externalIdKey: text('external_id_key').unique(),
  orderKey: text('order_key').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const scimGroupMember = pgTable('scim_group_member', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  groupId: text('group_id')
    .notNull()
    .references(() => scimGroup.id, { onDelete: 'cascade' }),
  scimUserId: text('scim_user_id')
    .notNull()
    .references(() => scimUser.id, { onDelete: 'cascade' }),
  membershipKey: text('membership_key').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
