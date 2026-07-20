CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"price_inr_monthly" integer DEFAULT 0 NOT NULL,
	"price_inr_annual" integer DEFAULT 0 NOT NULL,
	"limits" jsonb NOT NULL,
	"included_units" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_version_idx" ON "plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Seed the catalog from the built-in plan defaults (idempotent).
INSERT INTO "plans" ("key","name","sort_order","is_public") VALUES
  ('free','Free',0,true),
  ('starter','Starter',1,true),
  ('professional','Professional',2,true),
  ('enterprise','Enterprise',3,false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "plan_versions" ("plan_id","version","price_inr_monthly","price_inr_annual","limits")
SELECT p.id, 1, v.m, v.a, v.lim::jsonb
FROM "plans" p
JOIN (VALUES
  ('free', 0, 0, '{"devices":1,"users":1,"geofences":2,"apiCallsPerMonth":500,"historyDays":7}'),
  ('starter', 299, 2999, '{"devices":5,"users":3,"geofences":10,"apiCallsPerMonth":10000,"historyDays":90}'),
  ('professional', 999, 9999, '{"devices":25,"users":10,"geofences":50,"apiCallsPerMonth":100000,"historyDays":365}'),
  ('enterprise', 25000, 0, '{"devices":-1,"users":-1,"geofences":-1,"apiCallsPerMonth":-1,"historyDays":-1}')
) AS v(key, m, a, lim) ON p.key = v.key
ON CONFLICT ("plan_id","version") DO NOTHING;