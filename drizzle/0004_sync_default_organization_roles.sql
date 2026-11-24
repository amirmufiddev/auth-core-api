UPDATE "organization_role" AS role
SET "permission" = template."permission",
    "permission_scopes" = template."permission_scopes",
    "updated_at" = now()
FROM "organization_role_template" AS template
WHERE role."tenant_id" = template."tenant_id"
  AND role."role" = template."role_name"
  AND role."role" IN ('owner', 'admin', 'member');
