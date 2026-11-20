# AppDashboard — project plan

Last updated: 2026-11-20. Status: Phase 0 is built and both apps are deployed on Velocity. Still
open from Phase 0: a cron entry, custom domains, and the TikTok and Meta spikes. The production
database holds the four generated demo apps; remove them with `demo.clear` before the first real
sync.

## 1. Goal

One place to see the full funnel for a portfolio of about 10 mobile apps (4 actively worked on):
organic social → store → revenue. On top of the same data: a reviews inbox for both stores, an MCP
server so Claude can answer questions, and a Telegram bot that sends a daily report and answers
questions.

The project is also the subject of a sponsored YouTube video for Cloudways Velocity. Sponsor
requirements: one dedicated video, mandatory affiliate link disclosure, Cloudways featured for at
least 30% of the content, a full use case and deployment walkthrough, and at least one of React,
Next.js, TanStack, Astro, Vite, Angular, Express, Fastify.

Not in v1: ASO tracking, paid ads, true attribution (we show correlation and lift only),
multi-tenant accounts, email reports, replying to reviews, PostHog, Search Console.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Hosting | Cloudways Velocity, one Starter server ($20/month, 2 GB RAM, 2 vCPU, 5 apps) | Sponsor; always-on Node fits background work |
| Shape | Two apps in one repo: `apps/api` and `apps/web` | Background work, bot and MCP live in a plain Node service; UI deploys never interrupt them |
| API | Fastify 5 + tRPC 11 | On the sponsor's list; typed end to end |
| Dashboard | TanStack Start (React, Vite, Nitro for Node hosting) | Typed URL state and Query-first data fetching suit an interactive private dashboard |
| Database | Velocity's PostgreSQL, owned by the API only | Velocity attaches Postgres to one application |
| ORM | Drizzle, migrations run at API boot | No SSH on Velocity, so no manual migration step |
| Scheduling | Velocity Cron Job Management running Node commands | Official feature, visible in the dashboard, no queue library needed |
| Social data | Own TikTok sandbox app and own Meta app (Standard Access). No Postiz | No third-party dependency |
| Revenue source | RevenueCat only, in USD | One currency, one definition of revenue |
| Repo layout | Two independent npm packages, no workspaces | Velocity builds each app from its own root directory; avoids monorepo tooling risk |
| Web auth (v1) | Single user, password from env, encrypted cookie session | Private tool; real multi-user auth moves into the API if this becomes a SaaS |

## 3. Architecture

```
Velocity server (Starter)
├─ api  (Fastify, api.<domain>)
│    connectors · sync CLI (run by Velocity cron) · tRPC · MCP endpoint
│    Telegram webhook · OAuth callbacks (TikTok, Meta) · Postgres owner
├─ web  (TanStack Start, app.<domain>)
│    dashboard UI · login session · server functions that call api
└─ PostgreSQL (attached to api)
```

Rules that keep it simple:

- **The API is the only thing that touches Postgres.** Everything else is a client of the API.
- **The browser only talks to `web`.** Each read is a TanStack Start server function that checks
  the session, then calls the API through a server-only tRPC client carrying an internal bearer
  token. The token never reaches the browser, and there is no CORS or cross-domain cookie setup.
  There is no `/api/trpc` proxy route: Start's guidance is to call server functions from
  loaders, not the app's own server routes, and server functions get CSRF protection built in.
- **Public API surface is small:** `/mcp` (bearer token), `/telegram/webhook/<secret>`,
  `/oauth/tiktok/callback`, `/oauth/meta/callback`, `/health`. Everything under `/trpc` requires
  the internal token.
- **One query layer.** Each query is a function with a Zod input schema in
  `apps/api/src/queries/`. The same functions back the tRPC router, the MCP tools and the
  Telegram agent's tools.
- **Type sharing without workspaces:** `web` does
  `import type { AppRouter } from '../../../api/src/trpc/router'`. Type-only imports are erased at
  build time, so each app still builds on its own.

Repo layout:

```
apps/api/   src/{server.ts, cli.ts, db/, connectors/, queries/, trpc/, mcp/, telegram/, oauth/}
apps/web/   src/{routes/, components/, lib/}
PLAN.md
```

## 4. Platform facts

Verified in Cloudways' own support docs on 2026-11-20:

- Launch settings per app: framework preset (a "TanStack SSR" preset exists), branch, Node version
  (22 or 24), root directory, package manager, build command, start command.
- A monorepo subfolder is supported through the root directory setting.
- The app listens on port 3000 by default and Nginx forwards to it. A `PORT` env var set in the
  dashboard is passed to the process. The app must bind to `127.0.0.1` (IPv4); binding to the IPv6
  loopback only breaks routing.
- Auto-deploy on push to the configured branch, manual redeploy, deployment history, redeploying
  an older commit, downloadable build logs.
- Environment variables have a "Sensitive" toggle (hidden after saving) and `.env` import.
  Changes need a restart or redeploy.
- PostgreSQL is installed per application from Access Details. Cloudways adds the database env
  variables automatically; they apply on the next deploy. Installation cannot be undone. A
  Database Manager is built in.
- Cron Job Management per application runs Node commands (`node scripts/x.js`, `npm run task`)
  from a form or a crontab editor. Running crons are visible under Monitoring.
- Each application runs isolated: it cannot read another application's files or env variables,
  and has its own outbound IP.
- No SSH or command-line access.

Found by deploying on 2026-11-20:

- Attaching PostgreSQL injects `PGUSER`, `PGPASSWORD` (private), `PGHOST=localhost`,
  `PGPORT=5432` and `PGDATABASE` into that app. There is no `DATABASE_URL`.
- The build runs on the server with Node 24 and npm 11: `npm install` (dev dependencies
  included), then the build command, then the start command under PM2.
- npm skips dependency install scripts there too, as it does locally; both apps build anyway.
- The Fastify preset has no build step. The API uses the Other preset with an explicit build
  command; the TanStack SSR preset builds and starts the dashboard as is.
- A root directory per app works: two apps from one repository, `apps/api` and `apps/web`.
- The deploy log reports port 3000 for `api` ("default") and 3001 for `web` ("detected"), so
  apps on one server do not share a port.
- The storage size is required when creating a server; 25 GB was accepted for Starter.
- A push to the deployed branch redeploys both apps through a webhook, whichever folder changed.
- A deploy restarts the app: during one API redeploy, 1 of 40 health checks taken 6 seconds
  apart returned 502.

Still to verify:

1. Whether a cron command runs in the app's built directory with the app's env variables.
2. Whether `web` can reach `api` over localhost. Today `API_URL` is the API's public address.
3. Whether a build of `web` on the 2 GB server disturbs the running `api`.
4. Whether Postgres can be reached from a laptop (for local debugging against real data).

### What exists on Cloudways

| Resource | Id | Address |
|---|---|---|
| Velocity server `appdashboard` (Starter, $20/month, Frankfurt, 25 GB) | `1690499` | |
| App `api` (PostgreSQL attached) | `6797147` | https://nodejs-1690499-6797147.cloudwaysnodeapps.com |
| App `web` | `6797158` | https://nodejs-1690499-6797158.cloudwaysnodeapps.com |

Env variables set: `INTERNAL_API_TOKEN` on both apps, `ENCRYPTION_KEY` on `api`, and
`SESSION_SECRET` and `DASHBOARD_PASSWORD` on `web`, as private random values; `API_URL` on `web`. The dashboard
password is also recorded locally in the git-ignored `apps/web/.env.velocity`.

Both apps answer `GET /health`. The dashboard's reports `configured` (all its variables are
valid) and `api` (it can reach the API), so a deployment can be checked without signing in.

Launch settings for both apps are in [README.md](README.md).

### Deploying through the Cloudways MCP

Checked on 2026-11-20. The Cloudways MCP server has a `velocity_tools` toolset that can create
the server and apps, attach PostgreSQL, set env variables, add a domain and read deployments.
Nothing is created without the owner's confirmation.

- Repository: `VadimNotJustDev/AppDashboardPOC` (private), branch `main`.
- GitHub is linked to the Cloudways account. That OAuth step has to be done in the Cloudways
  console; it cannot be done through the MCP.
- Ids for the create calls: Starter plan `1` ($20/month, trial-eligible, 5 apps, 2 GB, 2 vCPU);
  cloud `do`; frameworks Fastify `2`, TanStack SSR `11`, Other `13`; Node v24 runtime `1`,
  v22 `2`. Regions: nyc3, ams3, blr1, atl1, fra1, lon1, sfo3, sgp1, syd1, tor1.
- No tool for Velocity cron entries was found in `velocity_tools`; that may be a console step.
- `velocity_plan_activate` and `velocity_app_create` accept `root_directory` inside
  `build_config`. With the Fastify preset they drop `build_command`; switch the app to the Other
  preset with `velocity_build_config_update` to keep it.

Sources: [launch](https://support.cloudways.com/en/articles/15550368-how-to-launch-a-velocity-application-on-cloudways),
[deployments](https://support.cloudways.com/en/articles/16187473-how-to-manage-deployments-for-your-cloudways-velocity-application),
[cron jobs](https://support.cloudways.com/en/articles/16187620-how-to-manage-cron-jobs-for-your-application-on-cloudways-velocity),
[database](https://support.cloudways.com/en/articles/16188001-how-to-connect-and-manage-a-database-for-your-application-on-cloudways-velocity),
[product page](https://www.cloudways.com/en/velocity.php).

## 5. Data model

All dates are UTC calendar days as reported by each source (see risk 5).

| Table | Purpose | Key columns |
|---|---|---|
| `apps` | The portfolio | `id` (slug), `name`, `icon_url`, `ios_app_id`, `android_package`, `revenuecat_project_id`, `is_active` |
| `connections` | Credentials that live in the database | `provider`, `app_id` (nullable), `external_account_id`, `display_name`, `access_token_enc`, `refresh_token_enc`, `expires_at`, `status` (`ok`, `needs_reauth`, `error`) |
| `metric_daily` | The single fact table | PK (`app_id`, `date`, `source`, `metric`, `dimension`), `value` |
| `posts` | Social posts | `platform`, `external_id`, `app_id`, `url`, `caption`, `published_at`, latest totals |
| `post_snapshot` | Nightly totals per post | PK (`post_id`, `date`), `views`, `likes`, `comments`, `shares`, `saves`, `reach` |
| `reviews` | Both stores | unique (`store`, `external_id`), `app_id`, `rating`, `title`, `body`, `author`, `territory`, `app_version`, `created_at`, `read_at` |
| `sync_runs` | Observability | `source`, `app_id`, `started_at`, `finished_at`, `status`, `rows_written`, `error` |
| `settings` | Telegram chat id, report time | key/value |

`metric_daily` examples: (`app_store`, `downloads`), (`google_play`, `downloads`),
(`app_store`, `page_views`), (`revenuecat`, `revenue`), (`revenuecat`, `mrr`), (`tiktok`, `views`),
(`instagram`, `reach`), (`tiktok`, `followers`). `dimension` is empty in v1 and leaves room for
country or traffic source.

Social platforms mostly report lifetime totals per post. The nightly snapshot stores totals, and
the difference between two nights becomes that day's `views` in `metric_daily`. History therefore
starts on the first sync.

OAuth tokens and pasted API keys are encrypted with AES-256-GCM using a key from an env variable.

## 6. Data sources

Every connector implements `sync(app, range)`, is idempotent (upserts), and re-fetches a trailing
7-day window so late data and corrections are absorbed.

### RevenueCat (built; verified against the API spec and RevenueCat's agent toolkit, not yet against a real key)

- `GET https://api.revenuecat.com/v2/projects/{project_id}/charts/{chart_name}` with
  `realtime=true`, `resolution=0` (daily), `start_date`, `end_date`, `currency=USD`.
- The response has `measures` (each with a `display_name`) and `values`, a flat list of points
  `{cohort, measure, value, incomplete}`. `cohort` is the period start in Unix seconds and
  `measure` indexes `measures`. A chart can carry several measures (revenue has Revenue and
  Transactions), so the connector picks one by name and falls back to the first.
- Charts stored: `revenue` → `revenue`, `mrr` → `mrr`, `actives` → `active_subs`, `trials` →
  `active_trials`, `trials_new` → `trials`, `customers_new` → `new_customers`. Six requests per
  app per sync.
- Auth: a v2 secret key per project, pasted in Settings and stored encrypted in `connections`.
  It needs `charts_metrics:charts:read`, plus `project_configuration:projects:read` and
  `project_configuration:apps:read` so the app can be created from the project (name, iOS bundle
  id, Android package).
- Rate limit: 25 requests per minute for Charts & Metrics; a 429 is retried after the wait
  RevenueCat asks for.
- Daily buckets are UTC. Recent periods can be flagged incomplete; they are stored and corrected
  by the next sync.
- To confirm with the first real key: that values are in dollars, not cents; the measure names
  the charts actually use (a mismatch is logged as a warning and the first measure is used).

### App Store Connect (downloads built; verified against Apple's docs and a stand-in server, not yet against a real key)

- Auth: a team API key (Issuer ID, Key ID, `.p8`) signed as an ES256 JWT with a 15-minute life,
  plus the vendor number. Entered in Settings and stored encrypted as one account-level
  connection. Individual keys cannot read sales reports.
- Roles: Sales and Reports (or Finance, Admin) reads sales reports. Only Admin can create
  analytics report requests; Sales and Reports can read the resulting reports.
- Downloads: `GET /v1/salesReports` with `frequency=DAILY`, `reportType=SALES`,
  `reportSubType=SUMMARY`, `version=1_0`, one gzipped TSV per day for the whole account. Columns
  are read by name. First downloads are product types 1, 1F, 1T, F1, 1E, 1EP, 1EU; re-downloads
  3x and updates 7x are stored separately. Refunds are negative units.
- A day without a report (not ready yet, or no activity) answers 404 and is skipped. When a
  report exists, an app of the account that is missing from it gets zero for that day.
- Reports arrive the next day by about 8 a.m. Pacific and are kept for a year, so the backfill
  is 364 days, four requests at a time.
- Apps: `GET /v1/apps` runs on connect and on every sync. Apps are matched by Apple ID or bundle
  id and created when new, so connecting RevenueCat and App Store in either order gives one app.
- Analytics (impressions, page views): on connect, an ONGOING analytics report request is
  created per app when the key allows it. Apple delivers the first reports in one to two days.
  Reading and parsing those reports is not built yet.
- To confirm with the first real key: the 404 behaviour for days without a report, and that
  `version=1_0` is accepted.

### Google Play (from prior knowledge; verify at implementation)

- Auth: one service account with Play Console access. Env variable.
- Installs and store listing visitors: monthly CSV files in the developer's Cloud Storage bucket,
  updated daily, UTF-16 encoded, a few days behind.
- Reviews: the Android Publisher reviews endpoint only returns reviews from the last week, so
  syncing must start early; older reviews come from the bucket's review CSVs.

### TikTok (verified against TikTok's docs, except the two items below)

- Sandbox app: no app review, up to 10 of your own accounts as target users per sandbox.
- OAuth: authorize at `https://www.tiktok.com/v2/auth/authorize/`, token exchange at
  `https://open.tiktokapis.com/v2/oauth/token/`. Redirect URIs must be HTTPS, static and an exact
  match, so the connect flow runs against the deployed API.
- Tokens: access token 2 hours, refresh token 180 days and rotating. Each refresh returns a new
  refresh token that must be saved; only one environment can own an account's token.
- Data: `/v2/video/list/` (20 per page, cursor) gives per video `view_count`, `like_count`,
  `comment_count`, `share_count`, `create_time`, `title`, `share_url`, `duration`.
  `/v2/user/info/` with `user.info.stats` gives `follower_count`, `likes_count`, `video_count`.
- Not available: daily series, reach, watch time, traffic sources.
- **Unverified:** that the sandbox returns real data for target users, and that `video.list` and
  `user.info.stats` are grantable in a sandbox. Test with one account before building.

### Instagram (verified against Meta's docs)

- An app that only serves accounts you own or manage uses Standard Access; App Review is not
  required. Accounts must be professional (business or creator).
- Account insights per day: `views`, `reach`, `accounts_engaged`, `likes`, `comments`, `shares`,
  `saves`, `total_interactions`, `follows_and_unfollows`. Stored for 90 days, so the first sync
  can backfill 90 days.
- Media insights (lifetime totals): `views`, `reach`, `likes`, `comments`, `shares`, `saved`,
  `ig_reels_avg_watch_time`. Can lag up to 48 hours.
- Tokens: long-lived token valid 60 days, refreshable once it is at least 24 hours old.

### Facebook Pages

Unverified: the Page insights reference did not load. Treated as optional in Phase 2.

## 7. Query layer

| Function | Returns |
|---|---|
| `listApps` | Apps with their connected sources |
| `getOverview({ from, to })` | Per-app totals for downloads, revenue and social views, with change vs the previous period |
| `getMetrics({ appIds, metrics, from, to, granularity })` | Time series for any `(source, metric)` pairs |
| `getFunnel({ appId, from, to })` | Views → store page views → downloads → trials → revenue, with step ratios |
| `listPosts({ appId, platform, from, to, sort, limit })` | Posts with totals and impact |
| `getPostImpact({ postId })` | Download and revenue lift in the 72 hours after the post vs a trailing 14-day baseline |
| `listReviews({ appId, store, rating, unread, cursor })` | Reviews |
| `markReviewsRead({ ids })` | — |
| `getSyncStatus` | Last run per source, failures, connections needing re-auth |
| `getDailyBrief({ date })` | The numbers behind the Telegram report |

A `DEMO_MODE` env flag makes this layer scale money and download numbers and alias app names, so
the dashboard, MCP and Telegram can all be recorded without showing real figures.

## 8. Phases

Each phase ends with something usable.

### Phase 0 — Spikes and foundations

1. **Velocity spike.** Start the trial, create a Starter server, deploy a hello-world Fastify app
   and a hello-world TanStack Start app from this repo, attach PostgreSQL to `api`, add one cron
   job. Answer the seven questions in section 4 and record the answers there.
2. **TikTok spike.** Create a developer app and sandbox, add one account, authorize, call
   `/v2/user/info/` and `/v2/video/list/`. Confirm the data is real.
3. **Meta spike.** Create an app, connect one Instagram professional account, call account and
   media insights. Check what Facebook Page insights return.
4. Repo scaffold: `apps/api`, `apps/web`, TypeScript, lint, env validation with Zod, git, GitHub.
5. Database: Drizzle schema for `apps`, `connections`, `metric_daily`, `sync_runs`; migrate at boot;
   local Postgres for development.
6. API skeleton: Fastify bound to `127.0.0.1`, `/health`, internal-token auth, tRPC router,
   connector interface, sync runner writing `sync_runs`, `cli.ts` with `sync`, `snapshot`, `report`.
7. Web skeleton: TanStack Start with Nitro, Tailwind and shadcn/ui, login, tRPC proxy route, app
   shell, date range held in typed search params.
8. Seed script that generates realistic fake data for a few demo apps.
9. Real deployment of both apps with custom domains.

Done when: you log in on the real domain and see a page whose data came from Postgres through the
API, and a scheduled no-op job has written a `sync_runs` row in production.

Status on 2026-11-20: steps 4 to 8 are done. Verified locally: the API tests pass; login, the
portfolio overview, range switching and sign-out work in a browser against Postgres; a request
without a session gets no data; the dashboard builds with the `apps/api` folder absent.
Differences from the list above:

- shadcn/ui is not installed. The skeleton uses Tailwind tokens only; add components when
  Phase 1 first needs one.
- `cli.ts` has `ping`, `sync`, `migrate` and `seed`. `snapshot` and `report` arrive with
  Phases 2 and 5.
- The overview page (Phase 1 step 6) exists, with charts on the per-app page.
- Steps 1 and 9 are done: both apps run on Velocity (see section 4).
- Still open: a cron entry running `node dist/cli.js ping`, custom domains, and the TikTok and
  Meta spikes (steps 2 and 3).

### Phase 1 — Downloads and revenue

1. Register the real apps.
2. RevenueCat connector and backfill.
3. App Store Connect sales connector and backfill; create the Analytics report requests.
4. Google Play installs and store performance connector.
5. App Store Connect analytics connector (impressions, page views) once instances exist.
6. Portfolio overview page; per-app page with downloads and revenue charts.
7. Settings page: connections, sync status, "Sync now".
8. Velocity cron: `sync` every 6 hours.

Done when: the overview shows real downloads and revenue for every app for the last 90 days and
updates without you touching it.

Status on 2026-11-20 (merged to `main` and deployed):

- Done: step 2 (RevenueCat connector with a 400-day backfill) and step 7 (Settings page: apps,
  connect RevenueCat, sync status, "Sync now", load and remove demo data). Step 1 happens
  through step 7: connecting a key creates the app from its RevenueCat project.
- Verified with tests and in a browser against a stand-in RevenueCat server. Not yet run against
  a real key.
- `ENCRYPTION_KEY` is set on the `api` app as a private variable, with a copy in the git-ignored
  `apps/api/.env.velocity`. Losing it makes the stored credentials unreadable.
- Step 3 (App Store downloads, plus the analytics report requests) is merged and deployed, with
  a form in Settings. Not yet run against a real key.
- RevenueCat has run against a real key: one app connected, 2,400 rows, no errors.
- Step 6 (per-app page) is merged and deployed: `/apps/<id>` shows one row per
  funnel step (social views, store page views, downloads, trials started, revenue, MRR) on a
  shared date axis, each on its own scale, with one crosshair that reads a day across every
  row. Days no source reported are gaps, not zeros. It covers Phase 2 step 5's timeline too; the
  post markers come with the social connectors. Query: `get_app_timeline`.
- Not started: step 4 (Google Play), step 5 (reading the analytics reports) and step 8 (cron,
  which needs a Velocity console entry: `node dist/cli.js sync` every six hours).

### Phase 2 — Social and the funnel chart

1. "Connect TikTok" and "Connect Instagram" flows, encrypted token storage, refresh on every sync,
   `needs_reauth` status.
2. TikTok connector: posts, nightly snapshots, derived daily views.
3. Instagram connector: daily account insights with 90-day backfill, media, snapshots.
4. Velocity cron: `snapshot` once a day at a fixed time.
5. Funnel timeline page: aligned charts on one date axis (social views by platform, store page
   views, downloads by store, trials, revenue) with a marker for each post.
6. Posts table with post impact.
7. Optional: Facebook Pages.

Done when: you open an app, see a views spike next to the downloads line, click it, and get the
post and its download lift.

### Phase 3 — Reviews inbox

1. App Store reviews connector (full history).
2. Google Play reviews connector (API plus CSV backfill).
3. Inbox page: filter by app, store, rating and unread; mark read; unread count in the nav.

Done when: you no longer need to open either console to know about new reviews.

### Phase 4 — MCP server

1. Register the query functions as MCP tools on `/mcp` (Streamable HTTP, bearer token).
2. Connect it to Claude and test real questions.
3. Tune tool descriptions and outputs: compact, units included, incomplete days flagged.

Done when: Claude answers "How did TikTok do last week, and did it bring downloads?" with numbers
that match the dashboard. Check which auth methods Claude's connector UI accepts before building.

### Phase 5 — Telegram

1. Bot with a webhook on the API, restricted to your chat id.
2. Daily brief via Velocity cron: yesterday vs the 7-day average, top post, new reviews, sync
   failures.
3. Alerts: a review of two stars or fewer, a connection needing re-auth.
4. Questions: a Claude API agent loop using the same tools as MCP. Read the current Claude API
   reference before implementing; model chosen by env variable.

Done when: the morning message arrives, and replying with a question returns an answer.

### Phase 6 — After the video

PostHog, Search Console, chart annotations ("changed hook strategy"), Facebook Pages, replying to
reviews, email digest, YouTube, ASO, paid ads, multi-tenant auth and billing, TikTok app review
and Meta Advanced Access.

## 9. Video outline

| # | Segment | Cloudways on screen |
|---|---|---|
| 1 | The problem and a demo of the finished tool | — |
| 2 | Architecture, and why this needs an always-on server; affiliate disclosure | Yes |
| 3 | Create the server, deploy the Fastify API from GitHub, attach PostgreSQL, env variables | Yes |
| 4 | Schema and the first connector end to end; push, auto-deploy, schedule it in Cron Job Management | Yes |
| 5 | Deploy the TanStack Start dashboard as a second app on the same server; domain and SSL | Yes |
| 6 | Fast-forward: stores, TikTok and Instagram connect, the funnel chart | Partly (logs, env variables) |
| 7 | Reviews inbox | — |
| 8 | MCP with Claude, then Telegram | Partly (cron for the report) |
| 9 | Monitoring, resource usage on the $20 plan, cost recap, affiliate link | Yes |

Segments 3, 4, 5 and 9 plus the returns in 6 and 8 are how the 30% is reached.

## 10. Accounts and credentials you need to create

- Cloudways account and a Velocity Starter server (3-day trial on Starter).
- A domain or subdomains for `app.` and `api.`.
- TikTok for Developers app with a sandbox; your TikTok accounts added as target users.
- Meta for Developers app; Instagram accounts set to professional and added to the app.
- RevenueCat: a v2 secret key with chart read permission for each project.
- App Store Connect: API key (issuer id, key id, `.p8`) and your vendor number.
- Google Play: a service account with access to reports and reviews, and the reports bucket id.
- Telegram: a bot from BotFather, and your chat id.
- Anthropic API key (Phase 5).

## 11. Risks

1. **TikTok sandbox may not return real data.** Mitigation: the Phase 0 spike. Fallback: submit
   the app for review, or enter TikTok numbers through another route for the video.
2. **Social history starts at the first sync.** Deploy the sync as early as possible so the video
   has weeks of real data.
3. **Google Play reviews older than a week are not in the API.** Same mitigation, plus CSV backfill.
4. **Rotating TikTok refresh tokens.** Only production owns social tokens; local development uses
   seed data.
5. **Day boundaries and lag differ per source.** Charts mark recent days as incomplete; treat
   single-day alignment as approximate.
6. **Correlation is not attribution.** The UI and the AI answers say "lift vs baseline".
7. **2 GB server.** Two Node processes, Postgres and on-server builds share it. Mitigation: watch
   the spike, upgrade to Professional ($30) if builds struggle.
8. **`nitro/vite` is marked as under active development** in TanStack's hosting guide. Pin versions.

## 12. Open questions

1. All ten apps in v1, or the four active ones?
2. Step-by-step tutorial, or a showcase with the schema and one connector built on camera?
3. Does every app have its own RevenueCat project, and are all apps under one App Store Connect
   account and one Play developer account?
4. Which social accounts belong to which app, and are the Instagram accounts professional?
5. Which domain, and what is the delivery date for the video?
