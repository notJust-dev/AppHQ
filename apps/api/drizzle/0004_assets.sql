CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"app_id" text,
	"connection_id" uuid,
	"ignored" boolean DEFAULT false NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "kind" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_kind_external_idx" ON "assets" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "assets_app_idx" ON "assets" USING btree ("app_id");--> statement-breakpoint
-- Everything below copies the links that lived on `apps` and `connections` into `assets`.
-- Accounts that promote several apps get a home: the one portfolio row.
INSERT INTO "apps" ("id", "name", "kind") VALUES ('portfolio', 'Shared accounts', 'portfolio')
  ON CONFLICT ("id") DO UPDATE SET "kind" = 'portfolio';--> statement-breakpoint
INSERT INTO "assets" ("kind", "external_id", "name", "app_id", "connection_id", "details")
  SELECT 'ios_app', a."ios_app_id", a."name", a."id",
    CASE WHEN a."id" LIKE 'demo-%' THEN NULL
      ELSE (SELECT c."id" FROM "connections" c WHERE c."provider" = 'app_store' AND c."app_id" IS NULL LIMIT 1) END,
    jsonb_build_object('bundleId', a."ios_bundle_id")
  FROM "apps" a WHERE a."ios_app_id" IS NOT NULL
  ON CONFLICT ("kind", "external_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "assets" ("kind", "external_id", "name", "app_id", "connection_id", "details")
  SELECT 'android_app', a."android_package", a."name", a."id",
    CASE WHEN a."id" LIKE 'demo-%' THEN NULL
      ELSE (SELECT c."id" FROM "connections" c WHERE c."provider" = 'google_play' AND c."app_id" IS NULL LIMIT 1) END,
    '{}'::jsonb
  FROM "apps" a WHERE a."android_package" IS NOT NULL
  ON CONFLICT ("kind", "external_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "assets" ("kind", "external_id", "name", "connection_id", "details")
  SELECT 'android_app', p->>'packageName', coalesce(p->>'title', p->>'packageName'), c."id",
    jsonb_build_object('title', p->>'title')
  FROM "connections" c, jsonb_array_elements(coalesce(c."details"->'packages', '[]'::jsonb)) p
  WHERE c."provider" = 'google_play' AND p->>'packageName' IS NOT NULL
  ON CONFLICT ("kind", "external_id") DO UPDATE SET "connection_id" = excluded."connection_id";--> statement-breakpoint
INSERT INTO "assets" ("kind", "external_id", "name", "app_id", "connection_id", "details")
  SELECT 'revenuecat_project', c."external_account_id", coalesce(c."display_name", c."external_account_id"),
    c."app_id", c."id",
    jsonb_build_object('bundleId', a."ios_bundle_id", 'androidPackage', a."android_package")
  FROM "connections" c LEFT JOIN "apps" a ON a."id" = c."app_id"
  WHERE c."provider" = 'revenuecat' AND c."external_account_id" IS NOT NULL
  ON CONFLICT ("kind", "external_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "assets" ("kind", "external_id", "name", "app_id", "connection_id")
  SELECT CASE c."provider" WHEN 'tiktok' THEN 'tiktok_account' WHEN 'facebook' THEN 'facebook_page' ELSE 'instagram_account' END,
    c."external_account_id", coalesce(c."display_name", c."external_account_id"), c."app_id", c."id"
  FROM "connections" c
  WHERE c."provider" IN ('tiktok', 'facebook', 'instagram') AND c."external_account_id" IS NOT NULL
  ON CONFLICT ("kind", "external_id") DO NOTHING;
