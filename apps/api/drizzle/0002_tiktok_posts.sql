CREATE TABLE "post_snapshots" (
	"post_id" uuid NOT NULL,
	"date" date NOT NULL,
	"views" bigint NOT NULL,
	"likes" bigint NOT NULL,
	"comments" bigint NOT NULL,
	"shares" bigint NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_snapshots_post_id_date_pk" PRIMARY KEY("post_id","date")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"app_id" text NOT NULL,
	"connection_id" uuid,
	"url" text,
	"caption" text,
	"published_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"comments" bigint DEFAULT 0 NOT NULL,
	"shares" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "refresh_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_snapshots" ADD CONSTRAINT "post_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_platform_external_idx" ON "posts" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "posts_app_published_idx" ON "posts" USING btree ("app_id","published_at");