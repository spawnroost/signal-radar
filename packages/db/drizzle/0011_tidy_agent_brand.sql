ALTER TABLE "payment" DROP CONSTRAINT "payment_provider_check";--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_status_check";--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_provider_check" CHECK ("payment"."provider" IN ('upi','instamojo','dodo'));--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_status_check" CHECK ("payment"."status" IN ('pending','approved','rejected','failed','refunded'));