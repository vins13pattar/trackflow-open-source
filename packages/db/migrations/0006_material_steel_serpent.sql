-- Convert "positions" into a monthly RANGE-partitioned table (by fix_time) and
-- add the partition-management functions the retention job calls. Partitioning
-- is transparent to the app: inserts/queries go through the parent. The id stays
-- globally unique via its original sequence; the PK becomes (id, fix_time)
-- because Postgres requires the partition key in every unique constraint.
--
-- The management functions are SECURITY DEFINER so the non-superuser runtime
-- role (which lacks CREATE/DROP) can provision/drop partitions through EXECUTE
-- grants applied in rls.ts. A DEFAULT partition guarantees ingest never drops a
-- position even if a month has not been provisioned yet.

CREATE OR REPLACE FUNCTION trackflow_ensure_positions_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('positions_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
  IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
    RETURN;
  END IF;

  -- Detach the default (if present) so creating a concrete range can't collide
  -- with rows that overflowed into it; move those rows in, then reattach.
  IF to_regclass('public.positions_default') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE positions DETACH PARTITION positions_default';
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF positions FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );

  IF to_regclass('public.positions_default') IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO positions SELECT * FROM positions_default WHERE fix_time >= %L AND fix_time < %L',
      v_start, v_end
    );
    EXECUTE format(
      'DELETE FROM positions_default WHERE fix_time >= %L AND fix_time < %L',
      v_start, v_end
    );
    EXECUTE 'ALTER TABLE positions ATTACH PARTITION positions_default DEFAULT';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trackflow_provision_positions_partitions(p_back integer DEFAULT 1, p_ahead integer DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m date;
BEGIN
  IF to_regclass('public.positions_default') IS NULL THEN
    EXECUTE 'CREATE TABLE positions_default PARTITION OF positions DEFAULT';
  END IF;
  FOR m IN
    SELECT generate_series(
      (date_trunc('month', now()) - make_interval(months => p_back)),
      (date_trunc('month', now()) + make_interval(months => p_ahead)),
      interval '1 month'
    )::date
  LOOP
    PERFORM trackflow_ensure_positions_partition(m);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trackflow_drop_positions_partitions_before(p_cutoff date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_month date;
  v_upper date;
  v_dropped integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'positions'
      AND c.relname ~ '^positions_[0-9]{4}_[0-9]{2}$'
  LOOP
    v_month := to_date(substring(r.relname from 'positions_(.*)$'), 'YYYY_MM');
    v_upper := (date_trunc('month', v_month) + interval '1 month')::date;
    IF v_upper <= p_cutoff THEN
      EXECUTE format('DROP TABLE %I', r.relname);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$;
--> statement-breakpoint
ALTER TABLE "positions" RENAME TO "positions_legacy";
--> statement-breakpoint
ALTER INDEX "positions_device_time_idx" RENAME TO "positions_legacy_device_time_idx";
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" bigint NOT NULL DEFAULT nextval('positions_id_seq'),
	"device_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"speed_kph" double precision DEFAULT 0 NOT NULL,
	"course" double precision DEFAULT 0 NOT NULL,
	"gps_valid" boolean DEFAULT true NOT NULL,
	"satellites" integer,
	"attributes" jsonb,
	"fix_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_id_fix_time_pk" PRIMARY KEY ("id", "fix_time")
) PARTITION BY RANGE ("fix_time");
--> statement-breakpoint
ALTER SEQUENCE "positions_id_seq" OWNED BY "positions"."id";
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "positions_device_time_idx" ON "positions" USING btree ("device_id","fix_time" DESC);
--> statement-breakpoint
DO $$
DECLARE
  v_min date;
  v_max date;
  m date;
BEGIN
  SELECT date_trunc('month', min(fix_time))::date,
         date_trunc('month', max(fix_time))::date
    INTO v_min, v_max
    FROM positions_legacy;
  IF to_regclass('public.positions_default') IS NULL THEN
    EXECUTE 'CREATE TABLE positions_default PARTITION OF positions DEFAULT';
  END IF;
  IF v_min IS NOT NULL THEN
    m := v_min;
    WHILE m <= v_max LOOP
      PERFORM trackflow_ensure_positions_partition(m);
      m := (date_trunc('month', m) + interval '1 month')::date;
    END LOOP;
  END IF;
END $$;
--> statement-breakpoint
SELECT trackflow_provision_positions_partitions(1, 3);
--> statement-breakpoint
INSERT INTO "positions" ("id","device_id","tenant_id","lat","lon","speed_kph","course","gps_valid","satellites","attributes","fix_time","received_at")
SELECT "id","device_id","tenant_id","lat","lon","speed_kph","course","gps_valid","satellites","attributes","fix_time","received_at"
FROM "positions_legacy";
--> statement-breakpoint
SELECT setval('positions_id_seq', COALESCE((SELECT max("id") FROM "positions"), 1));
--> statement-breakpoint
DROP TABLE "positions_legacy";
