CREATE TABLE "billing_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"unit_cost_inr" double precision DEFAULT 0 NOT NULL,
	"markup" double precision DEFAULT 2.5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_rates_resource_unique" UNIQUE("resource")
);
--> statement-breakpoint
ALTER TABLE "usage_counters" ADD COLUMN "whatsapp_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD COLUMN "email_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Seed default metered rates (operator cost × 2.5 markup); admin-editable.
INSERT INTO "billing_rates" ("resource","unit_cost_inr","markup") VALUES
  ('sms', 0.20, 2.5),
  ('whatsapp', 0.40, 2.5),
  ('email', 0.02, 2.5)
ON CONFLICT ("resource") DO NOTHING;