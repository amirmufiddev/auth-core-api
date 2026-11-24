ALTER TABLE "rbac_permission" RENAME TO "organization_permission";--> statement-breakpoint
ALTER TABLE "rbac_role_template" RENAME TO "organization_role_template";--> statement-breakpoint
DELETE FROM "organization_permission";--> statement-breakpoint
DELETE FROM "organization_role_template";--> statement-breakpoint
ALTER TABLE "organization_permission" ADD COLUMN "tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_permission" ADD CONSTRAINT "organization_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "uq_rbac_permission_resource_action_active";--> statement-breakpoint
CREATE INDEX "idx_organization_permission_tenant_id" ON "organization_permission" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organization_permission_tenant_resource_action_active" ON "organization_permission" USING btree ("tenant_id","resource","action") WHERE "organization_permission"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "organization_role_template" DROP CONSTRAINT "rbac_role_template_pkey";--> statement-breakpoint
ALTER TABLE "organization_role_template" ADD COLUMN "tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role_template" ADD CONSTRAINT "organization_role_template_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_template" ADD CONSTRAINT "organization_role_template_pkey" PRIMARY KEY ("tenant_id","role_name");--> statement-breakpoint
CREATE INDEX "idx_organization_role_template_tenant_id" ON "organization_role_template" USING btree ("tenant_id");--> statement-breakpoint
INSERT INTO "organization_permission" (
  "tenant_id", "resource", "action", "action_display_name", "action_description", "resource_display_name", "resource_description"
)
SELECT t."id", v.resource, v.action, v.action, 'Permission to ' || v.action || ' ' || v.resource, v.resource, 'Resource ' || v.resource
FROM "tenant" t
CROSS JOIN (
  VALUES
    ('member', 'read'),
    ('member', 'invite'),
    ('member', 'remove'),
    ('member', 'update-role'),
    ('ac', 'create'),
    ('ac', 'read'),
    ('ac', 'update'),
    ('ac', 'delete'),
    ('broadcast', 'trigger')
) AS v(resource, action);--> statement-breakpoint
INSERT INTO "organization_role_template" ("tenant_id", "role_name", "permission", "permission_scopes")
SELECT t."id", v.role_name, v.permission, v.permission_scopes
FROM "tenant" t
CROSS JOIN (
  VALUES
    (
      'owner',
      '{"member":["read","invite","remove","update-role"],"ac":["create","read","update","delete"],"broadcast":["trigger"]}',
      '{"member:read":"organization","member:invite":"organization","member:remove":"organization","member:update-role":"organization","ac:create":"organization","ac:read":"organization","ac:update":"organization","ac:delete":"organization","broadcast:trigger":"organization"}'
    ),
    (
      'admin',
      '{"member":["read","invite","remove","update-role"],"ac":["read"],"broadcast":["trigger"]}',
      '{"member:read":"organization","member:invite":"organization","member:remove":"organization","member:update-role":"organization","ac:read":"organization","broadcast:trigger":"organization"}'
    ),
    (
      'member',
      '{"member":["read"]}',
      '{"member:read":"organization"}'
    )
) AS v(role_name, permission, permission_scopes);
