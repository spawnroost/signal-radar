CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pass_id" text NOT NULL,
	"days" integer NOT NULL,
	"amount" integer NOT NULL,
	"provider" text DEFAULT 'upi' NOT NULL,
	"provider_ref" text,
	"utr" text,
	"note" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"telegram_message_id" integer,
	CONSTRAINT "payment_utr_unique" UNIQUE("utr"),
	CONSTRAINT "payment_provider_ref_unique" UNIQUE("provider","provider_ref"),
	CONSTRAINT "payment_utr_format" CHECK ("payment"."utr" IS NULL OR "payment"."utr" ~ '^[0-9]{12}$'),
	CONSTRAINT "payment_upi_needs_utr" CHECK ("payment"."provider" <> 'upi' OR "payment"."utr" IS NOT NULL),
	CONSTRAINT "payment_provider_check" CHECK ("payment"."provider" IN ('upi','instamojo')),
	CONSTRAINT "payment_status_check" CHECK ("payment"."status" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "expiry_reminder_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_user_idx" ON "payment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "payment" USING btree ("status","created_at");