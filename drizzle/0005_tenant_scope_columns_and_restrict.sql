ALTER TABLE "account" DROP CONSTRAINT "account_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "apikey" DROP CONSTRAINT "apikey_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "device_code" DROP CONSTRAINT "device_code_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "member_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_access_token" DROP CONSTRAINT "oauth_access_token_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_client" DROP CONSTRAINT "oauth_client_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_consent" DROP CONSTRAINT "oauth_consent_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" DROP CONSTRAINT "oauth_refresh_token_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT "organization_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_permission" DROP CONSTRAINT "organization_permission_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_role" DROP CONSTRAINT "organization_role_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_role_template" DROP CONSTRAINT "organization_role_template_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "passkey" DROP CONSTRAINT "passkey_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "sso_provider" DROP CONSTRAINT "sso_provider_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_auth_feature_config" DROP CONSTRAINT "tenant_auth_feature_config_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_billing_records" DROP CONSTRAINT "tenant_billing_records_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "two_factor" DROP CONSTRAINT "two_factor_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "verification" DROP CONSTRAINT "verification_tenant_id_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "apikey" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_trail_logs" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "device_code" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_permission" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role_template" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_auth_feature_config" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_billing_records" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN "tenant_scope" text GENERATED ALWAYS AS (coalesce(tenant_id, '')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_permission" ADD CONSTRAINT "organization_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "organization_role_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_template" ADD CONSTRAINT "organization_role_template_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_auth_feature_config" ADD CONSTRAINT "tenant_auth_feature_config_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_records" ADD CONSTRAINT "tenant_billing_records_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification" ADD CONSTRAINT "verification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "uq_organization_id_tenant_scope" UNIQUE("id","tenant_scope");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "uq_user_id_tenant_scope" UNIQUE("id","tenant_scope");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "ck_account_tenant_id_not_blank" CHECK ("account"."tenant_id" IS NULL OR "account"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "ck_apikey_tenant_id_not_blank" CHECK ("apikey"."tenant_id" IS NULL OR "apikey"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "audit_trail_logs" ADD CONSTRAINT "ck_audit_trail_logs_tenant_id_not_blank" CHECK ("audit_trail_logs"."tenant_id" IS NULL OR "audit_trail_logs"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "ck_device_code_tenant_id_not_blank" CHECK ("device_code"."tenant_id" IS NULL OR "device_code"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "ck_invitation_tenant_id_not_blank" CHECK ("invitation"."tenant_id" IS NULL OR "invitation"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "ck_member_tenant_id_not_blank" CHECK ("member"."tenant_id" IS NULL OR "member"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "ck_oauth_access_token_tenant_id_not_blank" CHECK ("oauth_access_token"."tenant_id" IS NULL OR "oauth_access_token"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "ck_oauth_client_tenant_id_not_blank" CHECK ("oauth_client"."tenant_id" IS NULL OR "oauth_client"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "ck_oauth_consent_tenant_id_not_blank" CHECK ("oauth_consent"."tenant_id" IS NULL OR "oauth_consent"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "ck_oauth_refresh_token_tenant_id_not_blank" CHECK ("oauth_refresh_token"."tenant_id" IS NULL OR "oauth_refresh_token"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "ck_organization_tenant_id_not_blank" CHECK ("organization"."tenant_id" IS NULL OR "organization"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "organization_permission" ADD CONSTRAINT "ck_organization_permission_tenant_id_not_blank" CHECK ("organization_permission"."tenant_id" IS NULL OR "organization_permission"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "ck_organization_role_tenant_id_not_blank" CHECK ("organization_role"."tenant_id" IS NULL OR "organization_role"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "organization_role_template" ADD CONSTRAINT "ck_organization_role_template_tenant_id_not_blank" CHECK ("organization_role_template"."tenant_id" IS NULL OR "organization_role_template"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "ck_passkey_tenant_id_not_blank" CHECK ("passkey"."tenant_id" IS NULL OR "passkey"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "ck_session_tenant_id_not_blank" CHECK ("session"."tenant_id" IS NULL OR "session"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "ck_sso_provider_tenant_id_not_blank" CHECK ("sso_provider"."tenant_id" IS NULL OR "sso_provider"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "ck_tenant_id_not_blank" CHECK ("tenant"."id" <> '');--> statement-breakpoint
ALTER TABLE "tenant_auth_feature_config" ADD CONSTRAINT "ck_tenant_auth_feature_config_tenant_id_not_blank" CHECK ("tenant_auth_feature_config"."tenant_id" IS NULL OR "tenant_auth_feature_config"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "tenant_billing_records" ADD CONSTRAINT "ck_tenant_billing_records_tenant_id_not_blank" CHECK ("tenant_billing_records"."tenant_id" IS NULL OR "tenant_billing_records"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "ck_two_factor_tenant_id_not_blank" CHECK ("two_factor"."tenant_id" IS NULL OR "two_factor"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "ck_user_tenant_id_not_blank" CHECK ("user"."tenant_id" IS NULL OR "user"."tenant_id" <> '');--> statement-breakpoint
ALTER TABLE "verification" ADD CONSTRAINT "ck_verification_tenant_id_not_blank" CHECK ("verification"."tenant_id" IS NULL OR "verification"."tenant_id" <> '');