CREATE TABLE "tenant_notification_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"quiet_start" text,
	"quiet_end" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"throttle_per_hour" integer DEFAULT 10 NOT NULL,
	"critical_bypass" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" ADD CONSTRAINT "tenant_notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;