ALTER TABLE "devices" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint
-- One-time correction: the old default conflated "not yet reported" with
-- "disabled". Connectivity is now derived from lastSeen, so existing devices
-- become active (no-op on a fresh database).
UPDATE "devices" SET "status" = 'active' WHERE "status" = 'inactive';