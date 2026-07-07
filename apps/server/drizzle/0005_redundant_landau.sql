ALTER TABLE "resolutions" ADD COLUMN "doc_state" text DEFAULT 'working' NOT NULL;--> statement-breakpoint
ALTER TABLE "resolutions" ADD COLUMN "doc_note" text;--> statement-breakpoint
-- backfill: pre-existing resolutions are settled, not in flight
UPDATE "resolutions" SET "doc_state" = CASE WHEN "article_id" IS NOT NULL THEN 'already_documented' ELSE 'skipped' END;