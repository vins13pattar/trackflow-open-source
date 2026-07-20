ALTER TABLE "tenants" ADD COLUMN "custom_domain_hostname_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_domain_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_domain_ssl_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_domain_verification" jsonb;
