-- Row-level security on every table with organization_id (see the policies in src/db/schema.ts).
-- FORCE makes the policies hold for the table owner too, so that requests are restricted when they
-- run as the owner (a host that doesn't let the API create roles). The role requests run as
-- elsewhere, and its grants, are set up when the API starts (src/organizations/tenancy.ts), so a
-- role created later, or a database moved to another host, needs no migration.
-- No data changes: this applies the same way on top of any existing rows.
ALTER TABLE "apps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "metric_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "apps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "metric_daily" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "apps_organization" ON "apps" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "assets_organization" ON "assets" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid) and (app_id is null or app_id in (select id from apps)) and (connection_id is null or connection_id in (select id from connections)));--> statement-breakpoint
CREATE POLICY "connections_organization" ON "connections" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "metric_daily_organization" ON "metric_daily" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid) and app_id in (select id from apps));--> statement-breakpoint
CREATE POLICY "post_snapshots_organization" ON "post_snapshots" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid) and post_id in (select id from posts));--> statement-breakpoint
CREATE POLICY "posts_organization" ON "posts" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid) and app_id in (select id from apps) and (connection_id is null or connection_id in (select id from connections)));--> statement-breakpoint
CREATE POLICY "reviews_organization" ON "reviews" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid) and app_id in (select id from apps));--> statement-breakpoint
CREATE POLICY "sync_runs_organization" ON "sync_runs" AS PERMISSIVE FOR ALL TO public USING (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid)) WITH CHECK (organization_id = (select nullif(current_setting('app.organization_id', true), '')::uuid) and (app_id is null or app_id in (select id from apps)));