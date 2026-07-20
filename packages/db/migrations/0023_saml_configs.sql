CREATE TABLE "saml_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL UNIQUE,
	"enabled" boolean DEFAULT false NOT NULL,
	"entity_id" text NOT NULL,
	"sso_url" text NOT NULL,
	"certificate" text NOT NULL,
	"audience" text NOT NULL,
	"acs_url" text NOT NULL,
	"attribute_email" text DEFAULT 'email' NOT NULL,
	"attribute_name" text DEFAULT 'displayName' NOT NULL,
	"default_role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saml_configs" ADD CONSTRAINT "saml_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saml_configs_tenant_idx" ON "saml_configs" USING btree ("tenant_id");
