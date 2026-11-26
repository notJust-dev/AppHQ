-- Every piece of data belongs to an organization (Better Auth's organization plugin, default
-- names). One organization is created here and every existing row moves into it, and app ids
-- change from slugs to uuids, all in the same transaction as the rest of the migration.
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" uuid;--> statement-breakpoint
-- The organization the dashboard password works in (see src/organizations/dashboard.ts).
INSERT INTO "organization" ("name", "slug") VALUES ('Default organization', 'default');--> statement-breakpoint
-- Rules that point at the old text app ids, or are unique across the whole table.
ALTER TABLE "assets" DROP CONSTRAINT "assets_app_id_apps_id_fk";--> statement-breakpoint
ALTER TABLE "metric_daily" DROP CONSTRAINT "metric_daily_app_id_apps_id_fk";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_app_id_apps_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_app_id_apps_id_fk";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_app_id_apps_id_fk";--> statement-breakpoint
DROP INDEX "assets_kind_external_idx";--> statement-breakpoint
DROP INDEX "assets_app_idx";--> statement-breakpoint
DROP INDEX "connections_provider_account_idx";--> statement-breakpoint
DROP INDEX "metric_daily_date_idx";--> statement-breakpoint
DROP INDEX "posts_platform_external_idx";--> statement-breakpoint
DROP INDEX "posts_app_published_idx";--> statement-breakpoint
DROP INDEX "reviews_store_external_idx";--> statement-breakpoint
DROP INDEX "reviews_app_created_idx";--> statement-breakpoint
DROP INDEX "reviews_created_idx";--> statement-breakpoint
DROP INDEX "sync_runs_source_started_idx";--> statement-breakpoint
ALTER TABLE "metric_daily" DROP CONSTRAINT "metric_daily_app_id_date_source_metric_dimension_pk";--> statement-breakpoint
-- Every row goes to that organization: add the column, fill it, then require it.
ALTER TABLE "apps" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "apps" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "connections" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "assets" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_daily" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "metric_daily" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "metric_daily" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "posts" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "reviews" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "sync_runs" SET "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "sync_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
-- A snapshot is in its post's organization.
ALTER TABLE "post_snapshots" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "post_snapshots" SET "organization_id" = "posts"."organization_id" FROM "posts" WHERE "posts"."id" = "post_snapshots"."post_id";--> statement-breakpoint
ALTER TABLE "post_snapshots" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
-- Generated demo apps were told apart by the `demo-` prefix of their id; now by a flag.
ALTER TABLE "apps" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "apps" SET "demo" = true WHERE "id" LIKE 'demo-%';--> statement-breakpoint
-- App ids become uuids. Each app gets a new one, and every app_id is rewritten to match.
ALTER TABLE "apps" ADD COLUMN "new_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "new_app_id" uuid;--> statement-breakpoint
UPDATE "assets" SET "new_app_id" = "apps"."new_id" FROM "apps" WHERE "apps"."id" = "assets"."app_id";--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "app_id";--> statement-breakpoint
ALTER TABLE "assets" RENAME COLUMN "new_app_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "metric_daily" ADD COLUMN "new_app_id" uuid;--> statement-breakpoint
UPDATE "metric_daily" SET "new_app_id" = "apps"."new_id" FROM "apps" WHERE "apps"."id" = "metric_daily"."app_id";--> statement-breakpoint
ALTER TABLE "metric_daily" DROP COLUMN "app_id";--> statement-breakpoint
ALTER TABLE "metric_daily" RENAME COLUMN "new_app_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "metric_daily" ALTER COLUMN "app_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "new_app_id" uuid;--> statement-breakpoint
UPDATE "posts" SET "new_app_id" = "apps"."new_id" FROM "apps" WHERE "apps"."id" = "posts"."app_id";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "app_id";--> statement-breakpoint
ALTER TABLE "posts" RENAME COLUMN "new_app_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "app_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "new_app_id" uuid;--> statement-breakpoint
UPDATE "reviews" SET "new_app_id" = "apps"."new_id" FROM "apps" WHERE "apps"."id" = "reviews"."app_id";--> statement-breakpoint
ALTER TABLE "reviews" DROP COLUMN "app_id";--> statement-breakpoint
ALTER TABLE "reviews" RENAME COLUMN "new_app_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "app_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "new_app_id" uuid;--> statement-breakpoint
UPDATE "sync_runs" SET "new_app_id" = "apps"."new_id" FROM "apps" WHERE "apps"."id" = "sync_runs"."app_id";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP COLUMN "app_id";--> statement-breakpoint
ALTER TABLE "sync_runs" RENAME COLUMN "new_app_id" TO "app_id";--> statement-breakpoint
ALTER TABLE "apps" DROP CONSTRAINT "apps_pkey";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "apps" RENAME COLUMN "new_id" TO "id";--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_pkey" PRIMARY KEY ("id");--> statement-breakpoint
-- The new keys, indexes and foreign keys.
ALTER TABLE "metric_daily" ADD CONSTRAINT "metric_daily_organization_id_app_id_date_source_metric_dimension_pk" PRIMARY KEY("organization_id","app_id","date","source","metric","dimension");--> statement-breakpoint
CREATE INDEX "apps_org_idx" ON "apps" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apps_org_portfolio_idx" ON "apps" USING btree ("organization_id") WHERE "apps"."kind" = 'portfolio';--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_kind_external_idx" ON "assets" USING btree ("organization_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "assets_org_app_idx" ON "assets" USING btree ("organization_id","app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_org_provider_account_idx" ON "connections" USING btree ("organization_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "metric_daily_org_date_idx" ON "metric_daily" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_org_platform_external_idx" ON "posts" USING btree ("organization_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "posts_org_app_published_idx" ON "posts" USING btree ("organization_id","app_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_org_store_external_idx" ON "reviews" USING btree ("organization_id","store","external_id");--> statement-breakpoint
CREATE INDEX "reviews_org_app_created_idx" ON "reviews" USING btree ("organization_id","app_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_org_created_idx" ON "reviews" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_runs_org_source_started_idx" ON "sync_runs" USING btree ("organization_id","source","started_at");--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_daily" ADD CONSTRAINT "metric_daily_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_snapshots" ADD CONSTRAINT "post_snapshots_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_daily" ADD CONSTRAINT "metric_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
