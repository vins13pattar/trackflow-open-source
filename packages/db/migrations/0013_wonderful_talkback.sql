-- Drop any pre-existing duplicate fixes (keep the earliest-inserted row) so the
-- unique index can be created. No-op on a fresh database.
DELETE FROM "positions" p USING "positions" q
  WHERE p.device_id = q.device_id AND p.fix_time = q.fix_time AND p.id > q.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "positions_device_fixtime_uq" ON "positions" USING btree ("device_id","fix_time");