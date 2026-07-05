ALTER TABLE "requests" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "guest_name" text;