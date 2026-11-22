ALTER TABLE "connections" DROP CONSTRAINT "connections_app_id_apps_id_fk";
--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "ios_app_id";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "ios_bundle_id";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "android_package";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "revenuecat_project_id";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "app_id";