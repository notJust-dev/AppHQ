CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"store" text NOT NULL,
	"external_id" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text,
	"author" text,
	"territory" text,
	"language" text,
	"app_version" text,
	"device" text,
	"url" text,
	"reply" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_store_external_idx" ON "reviews" USING btree ("store","external_id");--> statement-breakpoint
CREATE INDEX "reviews_app_created_idx" ON "reviews" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_created_idx" ON "reviews" USING btree ("created_at");