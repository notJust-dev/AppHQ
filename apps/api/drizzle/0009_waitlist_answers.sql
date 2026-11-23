ALTER TABLE "waitlist" ADD COLUMN "answer_token" uuid;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "answers" jsonb;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "answers_completed_at" timestamp with time zone;