CREATE TABLE "saved_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"url_normalized" text NOT NULL,
	"title" text NOT NULL,
	"site_name" text,
	"excerpt" text,
	"image_url" text,
	"content" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_item" ADD CONSTRAINT "saved_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_item_user_url_uq" ON "saved_item" USING btree ("user_id","url_normalized");--> statement-breakpoint
CREATE INDEX "saved_item_user_created_idx" ON "saved_item" USING btree ("user_id","created_at");