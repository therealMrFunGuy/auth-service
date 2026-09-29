ALTER TABLE "service_event" DROP CONSTRAINT IF EXISTS "service_event_anchor_id_anchor_id_fk";--> statement-breakpoint
ALTER TABLE "service_event" DROP COLUMN IF EXISTS "anchor_id";--> statement-breakpoint
DROP TABLE IF EXISTS "anchor";
