# AppDashboard

One dashboard for a portfolio of mobile apps: organic social views, store downloads and revenue
on one page. The plan, decisions and current status are in [PLAN.md](PLAN.md).

## Layout

| Folder | What it is |
|---|---|
| `apps/api` | Fastify + tRPC + Drizzle. The only app that touches Postgres. Also the CLI that cron runs. |
| `apps/web` | TanStack Start dashboard. Its server functions call the API; the browser never does. |

The two apps are independent npm packages. Each installs, builds and deploys on its own.

The dashboard's interface is built from [shadcn/ui](https://ui.shadcn.com) components (Radix
base, "nova" style) in `apps/web/src/components/ui`, themed by the tokens in
`apps/web/src/styles.css`. Add one with `npx shadcn@latest add <name>` from `apps/web`. The
dashboard's own pieces, such as the sidebar, cards and charts, sit one folder up in
`src/components`.

## Run locally

Needs Node 22.13 or newer and Docker.

```bash
docker compose up -d
```

Create the two env files from their examples and fill in the blanks. `INTERNAL_API_TOKEN` must be
the same in both.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Start the API (it applies migrations when it boots), then load demo data:

```bash
cd apps/api && npm install && npm run dev
```

```bash
cd apps/api && npm run cli -- seed
```

Start the dashboard and open http://127.0.0.1:3000:

```bash
cd apps/web && npm install && npm run dev
```

## Connecting real data

Sign in and open Accounts. It lists every source with its state; Connect or Configure opens that
source's page, with the steps to get a key and the form. Keys you download (App Store Connect's
`.p8`, Google Play's JSON) can be dropped or chosen as files; they are read in the browser and sent
like a pasted key. What a source finds (iOS and Android apps, RevenueCat projects, Pages,
Instagram and TikTok accounts) lands on the Apps page under "Needs a decision". Nothing becomes an
app on its own: add the ones you want to track (one click for a store app), link the others to an
app or to Shared accounts (for a social account that promotes several apps), and ignore the rest,
one by one or all at once. Once an app exists, what exact evidence ties to it joins by itself,
like an Android package equal to its iOS bundle id. Each app has two tabs: Overview, with its
numbers and posts, and Settings, with its name, what feeds it, and a button to stop tracking it.
To add an app by name (one only on Android, say), use Add app on the Apps page. Linking
something fetches its history.

An app's Overview also has a funnel (social views, downloads, trials started, trials converted,
with the rate between each step; widths on a log scale, since the stages span orders of
magnitude) and, as an experiment, a Sankey of where its downloads went: by store, into a trial,
straight to paid, or neither, and what became of the trials (paid, still running, expired). Paid
has two ways in: after a trial, or straight from a download. The trial outcomes
come from RevenueCat's trial conversion chart, counted by the day each trial started, and are
read back 45 days on every sync, since a trial can still convert after it starts. Social views
stay out of the Sankey: nothing ties a view to a download, and a flow would pretend it does.

The Performance pages look at one part of the funnel across all apps, or one app picked at the
top: Social (posts, views by platform, followers, top posts with the download lift after each,
and posts, views and downloads on one day axis), Store (impressions, page views and downloads
as a funnel per store, and the share of page views that end in a download) and Monetisation
(revenue, MRR, subscriptions and trials). Each compares with the period before. A rate such as
revenue per download only counts the apps, and stores, that report both of its numbers.

Reviews collects the written App Store and Google Play reviews of the apps you track, newest
first, with any reply you gave. Filter by app, store, rating or unread, and mark reviews read as
you deal with them; the sidebar counts the unread ones. Reviews come with the store accounts you
already connected: App Store reviews need a key with the Admin, App Manager or Customer Support
role, and Google Play's come from the same bucket as the installs. Reviews more than two weeks
old when first imported arrive already read.

Privacy mode, at the bottom of the sidebar, blurs whatever could tell someone which apps and
accounts these are, for recording or sharing the screen: app names and icons, bundle ids, social
handles, websites, search terms, post captions, reviews and account names. The numbers stay
readable. It is remembered in that browser and applies from the first paint, so a reload never
flashes a name. It blurs the page only: the address bar still shows each app's id, which is made
from its name, and copying the page's text still copies the names.

For SEO, connect Google Search Console on the Accounts page with a Google Cloud service account:
the one Google Play uses works, or another key. Enable the Google Search Console API in that
service account's project, and in Search Console add its email to each website (Settings, Users
and permissions, Restricted is enough). Each website then waits on the Apps page to be linked to
its app, like a store app; 16 months of daily clicks, impressions and position are fetched. The
SEO page shows them with the top queries and pages, which are read from Google as it opens.

For revenue, open an app's Settings and paste a RevenueCat v2 secret key from that app's project
(a RevenueCat key belongs to one project, so it is connected per app, not on the Accounts page).
The key needs read access to charts and metrics, and to project configuration. About a year of
history is fetched, and later syncs re-read the last seven days. The Accounts page lists every
app's project and its state.

For downloads and store page views, connect App Store Connect with a team API key (the `.p8`
file, whose name gives the Key ID, and the Issuer ID) and your vendor number. The account's apps
wait on the Apps page; a year of daily downloads is fetched for each one you add. Store page
views and impressions come from Apple's analytics reports, which Apple makes only once asked,
per app: the sync asks for each app you track (an ongoing report, and a one-time snapshot of the
history back to January 2024) and reads them a day or two later. Only an Admin key may ask, so
use one at least the first time; a Sales and Reports key is enough for downloads and for reading
reports already asked for. Without one, the App Store Connect page says so.

Each sync also reads every app's icon from its newest build, and an app shows the icon of the iOS
app linked to it. A key that may not read builds falls back to the public App Store listing,
which knows only apps on sale in the US store; the others keep their first letter.

For Google Play, create a service account in Google Cloud with a JSON key, and invite its email
in Play Console (Users and permissions) with "View app information and download bulk reports"
for all apps; access can take up to a day. On the Google Play page, add the key file and the Cloud Storage URI
from Play Console (Download reports, Statistics, Copy Cloud Storage URI). Packages whose name
equals an iOS bundle id are linked to that app; link the others on the Apps page, or make a new one.
Downloads are new users per day and store page views are store listing visitors, both from
Google's monthly report files, which arrive 3 to 7 days late. Enabling the Play Developer
Reporting API in the service account's project adds app titles. `GOOGLE_STORAGE_URL` and
`GOOGLE_PLAY_REPORTING_URL` point the API at a stand-in.

For TikTok, create an app (or a sandbox of one) at developers.tiktok.com with Login Kit for web
and the scopes `user.info.basic`, `user.info.profile`, `user.info.stats` and `video.list`.
Register the redirect URI that the TikTok page shows under "Setting up the TikTok app", exactly as written, and
set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` on the API (a sandbox has its own pair). Then
pick the app an account promotes (or Shared accounts) and press Connect TikTok. Every sync saves each video's
lifetime totals as that day's snapshot; daily views are the gains between days, so they start
the day after an account is connected. With a sandbox, only the accounts added as target users
can sign in.

To try the flow without TikTok, point the API at a stand-in with `TIKTOK_API_URL` and
`TIKTOK_AUTH_URL`.

For Facebook Pages and Instagram, create an app at developers.facebook.com, owned by your business
portfolio, with the use cases "Manage everything on your Page" and "Manage messaging & content on
Instagram" (API setup with Unified login; the Facebook login setup also works). Add the redirect URI that the Facebook and Instagram page shows under "Setting up the Meta
app", and create a login configuration (user access token) with `pages_show_list`,
`pages_read_engagement`, `pages_read_user_content`, `read_insights`, `instagram_basic`,
`instagram_manage_insights` and `business_management`. Set `META_APP_ID`, `META_APP_SECRET` and
`META_LOGIN_CONFIG_ID` on the API. One sign-in finds every Page you manage and the Instagram
accounts linked to them; link each to the app it promotes on the Apps page. Facebook brings a year of daily
Page insights, Instagram 90 days. Meta's sign-in lasts about 60 days and cannot be renewed by the
server, so sign in again before the date its page shows (Facebook Pages keep working without).
`META_GRAPH_URL` and `META_DIALOG_URL` point the API at a stand-in.

For YouTube, create an OAuth client of type Web application in Google Cloud, in a project with
the YouTube Data API v3 and the YouTube Analytics API enabled; its consent screen needs the
`youtube.readonly` and `yt-analytics.readonly` scopes (add yourself as a test user while it is in
testing). Add the redirect URI the YouTube page shows, and set `GOOGLE_OAUTH_CLIENT_ID` and
`GOOGLE_OAUTH_CLIENT_SECRET` on the API. Sign in once per channel (a brand account is a channel
of its own), then link each to the app it promotes. YouTube views count toward social views;
the sync reads daily views, likes, comments and shares, subscribers, and a year of videos.

## Commands

| Where | Command | What it does |
|---|---|---|
| `apps/api` | `npm test` | Unit tests. With `TEST_DATABASE_URL` set, also the tests that need Postgres; the database name must end in `_test` |
| `apps/api` | `npm run typecheck` | Type check |
| `apps/api` | `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `apps/api` | `npm run cli -- ping` | Write a heartbeat row to `sync_runs` (checks a cron entry) |
| `apps/api` | `npm run cli -- sync` | Run the connectors over the last 7 days |
| `apps/api` | `npm run cli -- seed` | Replace the demo apps with generated data |
| `apps/web` | `npm run typecheck` | Type check |
| `apps/web` | `npm run build` then `npm run start` | Production build and server |

## Deploying to Cloudways Velocity

Both apps deploy from this repository to the same server. Settings that work:

| Setting | `api` | `web` |
|---|---|---|
| Root directory | `apps/api` | `apps/web` |
| Framework preset | Other | TanStack SSR |
| Install command | `npm install` | `npm install` |
| Build command | `npm run build` | `npm run build` |
| Start command | `npm run start` | `npm run start` |
| Database | Attach PostgreSQL here | None |
| Env variables | `INTERNAL_API_TOKEN`, `ENCRYPTION_KEY`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `API_URL`, `INTERNAL_API_TOKEN`, `SESSION_SECRET`, `DASHBOARD_PASSWORD`, optional `PUBLIC_URL` |
| Cron | `node dist/cli.js sync` | None |

Things to know:

- **Use the Other preset for the API.** The Fastify preset runs `npm install` and the start
  command only, with no build step, so a TypeScript API never gets compiled.
- **No `DATABASE_URL` on Velocity.** Attaching PostgreSQL injects `PGHOST`, `PGPORT`,
  `PGDATABASE`, `PGUSER` and `PGPASSWORD` into the app, and the API connects with those.
- **Leave `NODE_ENV` unset.** npm skips dev dependencies when it is `production`, and both
  builds need them (TypeScript, Vite). The dashboard's production build is already in
  production mode without it.
- **`API_URL` is the API app's public address.** Whether two apps on one server can reach each
  other over localhost has not been tested.
- **A push to `main` redeploys both apps,** whichever folder changed. Each app restarts briefly.
- **Both apps answer `GET /health`.** The dashboard's also says whether it is fully configured
  and can reach the API, so a deployment can be checked without signing in.
- **`ENCRYPTION_KEY` protects stored credentials.** API keys pasted on the Accounts page are encrypted
  with it before they reach the database. The API starts without it, but connecting a source
  then fails with a message saying so. Changing it means reconnecting every source.
- **Demo data without a shell.** `POST /trpc/demo.seed` and `POST /trpc/demo.clear` on the API,
  sent with the internal token, load and remove the generated demo apps. They only touch apps
  whose id starts with `demo-`.
- **The TikTok redirect URI comes from the request** (the proxy's forwarded host and
  protocol). If a source's page shows the wrong redirect address, set `PUBLIC_URL` on the dashboard, for
  example `https://app.example.com`.
- Both apps listen on `PORT` when it is set and on 3000 otherwise, over IPv4.
