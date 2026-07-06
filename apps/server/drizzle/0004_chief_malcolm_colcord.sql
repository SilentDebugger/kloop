CREATE TABLE "article_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"article_a_id" uuid NOT NULL,
	"article_b_id" uuid NOT NULL,
	"source" text DEFAULT 'crosslink' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_article_a_id_articles_id_fk" FOREIGN KEY ("article_a_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_article_b_id_articles_id_fk" FOREIGN KEY ("article_b_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_links_pair_idx" ON "article_links" USING btree ("article_a_id","article_b_id");--> statement-breakpoint
CREATE INDEX "article_links_org_idx" ON "article_links" USING btree ("org_id");