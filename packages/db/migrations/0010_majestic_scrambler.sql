CREATE TABLE "daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"day" date NOT NULL,
	"trips" integer DEFAULT 0 NOT NULL,
	"distance_km" double precision DEFAULT 0 NOT NULL,
	"duration_s" integer DEFAULT 0 NOT NULL,
	"max_speed_kph" double precision DEFAULT 0 NOT NULL,
	"speeding_samples" integer DEFAULT 0 NOT NULL,
	"point_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_rollups" ADD CONSTRAINT "daily_rollups_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_rollups_device_day_idx" ON "daily_rollups" USING btree ("device_id","day");--> statement-breakpoint
CREATE INDEX "daily_rollups_tenant_day_idx" ON "daily_rollups" USING btree ("tenant_id","day");