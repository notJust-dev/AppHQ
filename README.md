# AppHQ

A self-hosted dashboard for indie developers who run several mobile apps. It shows each app's
whole funnel in one place, from social post to store download to revenue, and collects reviews
from both stores into one inbox.

- **Portfolio overview:** every app with its social views, downloads, trials and revenue, each
  compared with the previous period.
- **Per-app page:** a funnel (views → downloads → trials → paid), a flow chart of where downloads
  went, daily charts, and the posts that drove the most downloads afterwards.
- **Social, Store, Monetisation and SEO pages:** one part of the funnel across all apps.
- **Reviews inbox:** App Store and Google Play reviews, newest first, with read/unread.
- **Privacy mode:** blurs app names, icons and handles so you can record or share your screen.

It reads from **App Store Connect, Google Play, RevenueCat, TikTok, Instagram, Facebook Pages,
YouTube and Google Search Console** using your own API keys and developer apps. There is no
third-party service in between. Credentials are encrypted before they are stored, and the
dashboard is protected by a single password.

## How it works

```
Browser ──▶ web (TanStack Start)  ──internal token──▶  api (Fastify + tRPC)  ──▶ PostgreSQL
            login, dashboard UI,                       connectors, scheduled
            server functions                           syncs, migrations
```

| Folder | What it is |
|---|---|
| `apps/api` | Fastify + tRPC + Drizzle. The only part that touches Postgres. Runs the data syncs on a schedule and applies migrations when it boots. Also includes a small CLI. |
| `apps/web` | TanStack Start dashboard (React, Vite, shadcn/ui). Its server functions call the API with a shared secret, so the browser never talks to the API directly. |

The two apps are independent npm packages. Each one installs, builds and deploys on its own.
Both need **Node 22.13 or newer**.

## Run it locally

You need Node and Docker (only for the local Postgres).

**1. Start Postgres**

```bash
docker compose up -d
```

**2. Create the env files**

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env
```

Fill in the blanks. Generate each secret with `openssl rand -hex 32`:

| File | Variable | Value |
|---|---|---|
| both | `INTERNAL_API_TOKEN` | The same random value in both files |
| `apps/api/.env` | `ENCRYPTION_KEY` | Random, 64 hex characters. Encrypts stored credentials. |
| `apps/web/.env` | `SESSION_SECRET` | Random, 32+ characters |
| `apps/web/.env` | `DASHBOARD_PASSWORD` | The password you will sign in with, 12+ characters |

**3. Start the API** (it creates the tables on first boot)

```bash
cd apps/api && npm install && npm run dev
```

**4. (Optional) Load demo data**, four made-up apps with months of numbers:

```bash
cd apps/api && npm run cli -- seed
```

**5. Start the dashboard**

```bash
cd apps/web && npm install && npm run dev
```

Open http://127.0.0.1:3000/login and sign in with `DASHBOARD_PASSWORD`.

Signed-out visitors to `/` see a public landing page with a waitlist form (sign-ups are stored
in the `waitlist` table). The dashboard itself is always at `/login` and behind the password.

## Deploy to Cloudways Velocity

[Cloudways Velocity](https://www.cloudways.com/en/velocity.php) runs always-on Node.js apps
deployed from GitHub, which suits AppHQ: the API keeps running between requests, so it can sync
your data on a schedule. Both apps and the database fit on one Starter server.

> **Disclosure:** the Cloudways sign-up links in this README are affiliate links. If you sign up
> through them, I may earn a commission at no extra cost to you. [Sign up for Cloudways](https://unified.cloudways.com/signup?id=2228590&data1=notjustdev&data2=sponsorship).

You will create **two Velocity applications from the same repository**: `api` (with
PostgreSQL attached) and `web`.

### 1. Fork the repository

Fork this repository to your GitHub account (or push a copy to a new repository). Velocity
deploys from GitHub and redeploys on every push to the branch you choose.

### 2. Create a Velocity server

1. [Create a Cloudways account](https://unified.cloudways.com/signup?id=2228590&data1=notjustdev&data2=sponsorship) (or sign in) and create a **Velocity** server. The
   **Starter** plan is enough.
2. Pick the region closest to you and a storage size (25 GB is plenty).
3. Connect your GitHub account to Cloudways when it asks, and give the Cloudways GitHub app
   access to your fork.

### 3. Create the `api` application

Add an application on the server with these launch settings:

| Setting | Value |
|---|---|
| Repository and branch | Your fork, `main` |
| Framework preset | **Other** |
| Node version | 22 or 24 |
| Root directory | `apps/api` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Start command | `npm run start` |

> Use the **Other** preset, not Fastify. The Fastify preset has no build step, so the
> TypeScript API would never be compiled.

### 4. Attach PostgreSQL to `api`

Open the `api` application's **Access Details** and install **PostgreSQL**. Velocity then
injects `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD` into the app, and the API
connects with them. You don't set `DATABASE_URL` on Velocity. The API creates its tables on the
next deploy.

### 5. Set the `api` environment variables

Generate two secrets on your machine (run it twice):

```bash
openssl rand -hex 32
```

Add them on the `api` application. Turn on **Sensitive** for the secrets, because Velocity
never shows a sensitive value again, so keep a copy somewhere safe.

| Variable | Value |
|---|---|
| `INTERNAL_API_TOKEN` | The first generated value |
| `ENCRYPTION_KEY` | The second generated value. If you lose or change it, every connected source has to be connected again. |
| `SYNC_EVERY_HOURS` | Optional. Hours between automatic syncs, default `3` |

Add the variables for TikTok, Meta and YouTube later, when you set those sources up (see
[Connecting your data](#connecting-your-data)).

**Leave `NODE_ENV` unset.** When it is `production`, npm skips dev dependencies, and both builds
need them (TypeScript, Vite).

Deploy (or redeploy) the app. When it is live, open `https://<api address>/health` in your
browser. You should see `{"ok":true,"db":"up"}`.

### 6. Create the `web` application

Add a second application on the same server, from the same repository:

| Setting | Value |
|---|---|
| Repository and branch | Your fork, `main` |
| Framework preset | **TanStack SSR** |
| Node version | 22 or 24 |
| Root directory | `apps/web` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Start command | `npm run start` |

### 7. Set the `web` environment variables

| Variable | Value |
|---|---|
| `API_URL` | The `api` application's public address, e.g. `https://nodejs-…cloudwaysnodeapps.com` (no trailing slash) |
| `INTERNAL_API_TOKEN` | The **same** value as on `api` |
| `SESSION_SECRET` | A new `openssl rand -hex 32` value |
| `DASHBOARD_PASSWORD` | The password you will sign in with, 12+ characters |
| `PUBLIC_URL` | Optional. The dashboard's own address, if the sign-in redirect addresses on the Accounts page come out wrong (for example behind a custom domain) |

Deploy the app, then open `https://<web address>/health`. It reports whether the dashboard is
fully configured and whether it can reach the API, so you can check the setup without
signing in.

### 8. Sign in

Open `https://<web address>/login` and sign in with `DASHBOARD_PASSWORD`. Then go to
**Accounts** to connect your first source.

To look around with demo data first, send this request (with your internal token) to the API.
It loads four made-up apps whose ids start with `demo-`:

```bash
curl -X POST https://<api address>/trpc/demo.seed \
  -H "Authorization: Bearer <INTERNAL_API_TOKEN>" \
  -H "Content-Type: application/json" -d '{}'
```

Remove them before you connect real data. The same request to `demo.clear` deletes them and
nothing else.

### 9. (Optional) Custom domains

Add a domain to each application in Velocity, for example `app.example.com` for `web` and
`api.example.com` for `api`. Then update `API_URL` on `web`, set `PUBLIC_URL` on `web` to the
new dashboard address, and update the redirect URIs registered with TikTok, Meta and Google.

### Good to know

- **A push to your deploy branch redeploys both apps**, whichever folder changed. Each restarts
  for a few seconds.
- **Syncs run inside the API**, every `SYNC_EVERY_HOURS`. You don't need a Velocity cron job.
  Cron commands on Velocity don't receive the app's environment variables, so a cron sync could
  not reach the database anyway.
- **Both apps listen on `PORT`** when it is set, and on 3000 otherwise, over IPv4. Velocity
  assigns the ports, so you can leave `PORT` unset.
- **Leftover files.** Velocity's deploy pulls new commits but does not delete files you removed
  from the repository. The API builds only from its entry points, so leftovers there are
  harmless. In `apps/web`, every file in `src/routes` becomes a route, so if you remove a route,
  replace its contents with a redirect instead of deleting the file.

## Connecting your data

Sign in and open **Accounts**. It lists every source with its state. Each source's page has the
steps to get a key and a form to paste it into. Key files (App Store Connect's `.p8`, Google
Play's JSON) can be dropped onto the form; they are read in the browser.

What a source finds (iOS and Android apps, RevenueCat projects, Pages, Instagram, TikTok and
YouTube accounts, websites) waits on the **Apps** page under "Needs a decision". Nothing becomes
an app on its own. You can:

- **Add** an app you want to track (one click for a store app).
- **Link** something to an existing app, or to **Shared accounts** for a social account that
  promotes several apps.
- **Ignore** what you don't want, one by one or all at once.

Once an app exists, data that clearly belongs to it joins automatically, like an Android package
equal to its iOS bundle id. Linking something fetches its history. To add an app by name (one
only on Android, say), use **Add app** on the Apps page.

### App Store Connect (downloads, store page views, reviews, icons)

1. In App Store Connect, go to **Users and Access → Integrations → App Store Connect API** and
   create a **team** key. Download the `.p8` file (its name contains the Key ID) and note the
   Issuer ID.
2. Find your vendor number in **Payments and Financial Reports**.
3. Enter all of these on the App Store Connect page.

Use an **Admin** key, at least the first time. Store page views and impressions come from Apple's
analytics reports, which Apple only generates once someone asks for them, per app, and only an
Admin key can ask. The sync asks for every app you track, and the data appears a day or two
later. A Sales and Reports key is enough for downloads and for reading reports already requested.
Reviews need the Admin, App Manager or Customer Support role.

A year of daily downloads is fetched for each app you add. Icons come from each app's newest
build, or from the public App Store listing if the key cannot read builds.

### Google Play (downloads, store listing visitors, reviews)

1. In Google Cloud, create a **service account** with a JSON key.
2. In Play Console, under **Users and permissions**, invite the service account's email with
   **View app information and download bulk reports** for all apps. Access can take up to a day.
3. In Play Console, go to **Download reports → Statistics** and click **Copy Cloud Storage URI**.
4. On the Google Play page, add the JSON key and the Cloud Storage URI.

Optionally, enable the **Google Play Developer Reporting API** in the service account's project
to get app titles. Google's monthly report files arrive 3 to 7 days late, so the most recent
days fill in later.

### RevenueCat (revenue, MRR, trials, subscriptions)

A RevenueCat key belongs to one project, so it is connected **per app**: open the app's
**Settings** and paste a **v2 secret key** with read access to charts and metrics, and to project
configuration. About a year of history is fetched. Revenue is in USD.

### TikTok (posts, views, followers)

1. Create an app at [developers.tiktok.com](https://developers.tiktok.com) with **Login Kit for
   web** and the scopes `user.info.basic`, `user.info.profile`, `user.info.stats` and
   `video.list`. A sandbox works for your own accounts: add them as target users.
2. Register the redirect URI shown on AppHQ's TikTok page, exactly as written.
3. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` on the API and redeploy.
4. On the TikTok page, pick the app the account promotes (or Shared accounts) and press
   **Connect TikTok**.

TikTok has no daily view history. Every sync saves each video's lifetime totals, and daily views
are the difference between days, so they begin the day after you connect. Before that, each
video's views sit on the day it was posted, and the charts mark where daily views begin.

### Facebook Pages and Instagram

1. Create an app at [developers.facebook.com](https://developers.facebook.com), owned by your
   business portfolio, with the use cases **Manage everything on your Page** and **Manage
   messaging & content on Instagram**.
2. Add the redirect URI shown on AppHQ's Facebook and Instagram page.
3. Create a **Facebook Login for Business** configuration (user access token) with
   `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `read_insights`,
   `instagram_basic`, `instagram_manage_insights` and `business_management`.
4. Set `META_APP_ID`, `META_APP_SECRET` and `META_LOGIN_CONFIG_ID` on the API and redeploy.

One sign-in finds every Page you manage and the Instagram accounts linked to them. Facebook
brings a year of daily insights, and Instagram brings 90 days. Meta's sign-in lasts about 60 days, so
sign in again before the date shown on the page.

### YouTube

1. In Google Cloud, enable the **YouTube Data API v3** and the **YouTube Analytics API**.
2. Create an **OAuth client** of type **Web application**. Its consent screen needs the
   `youtube.readonly` and `yt-analytics.readonly` scopes. Add yourself as a test user while
   the app is in testing.
3. Add the redirect URI shown on AppHQ's YouTube page.
4. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` on the API and redeploy.

Sign in once per channel (a brand account counts as a separate channel).

### Google Search Console (SEO)

Use a Google Cloud service account, either the one from Google Play or a new one. Enable the
**Google Search Console API** in its project, then in Search Console add its email to each
website (**Settings → Users and permissions**, Restricted is enough). Connect it on the Accounts
page and link each website to its app. 16 months of clicks, impressions and position are fetched.

## Using the dashboard

- **Overview** lists every app with its funnel numbers for the chosen range, compared with the
  period before.
- **An app's page** has an Overview tab (funnel, download flow, charts, posts with the download
  lift after each) and a Settings tab (name, what feeds it, stop tracking).
- **Social, Store and Monetisation** show one part of the funnel across all apps, or for one
  app picked at the top. Rates such as revenue per download only count apps and stores that
  report both numbers.
- **Reviews** can be filtered by app, store, rating or unread. Mark reviews read as you handle
  them, and the sidebar shows how many are unread.
- **Privacy mode**, at the bottom of the sidebar, blurs names, icons, handles, captions and
  reviews while keeping numbers readable. It is remembered per browser.

Correlation is not attribution: "lift" after a post compares downloads with the days before it,
and the funnel and flow charts never claim that a specific view caused a specific download.

## Development

| Where | Command | What it does |
|---|---|---|
| `apps/api` | `npm test` | Unit tests. With `TEST_DATABASE_URL` set (database name ending in `_test`), also the Postgres tests |
| `apps/api` | `npm run typecheck` | Type check |
| `apps/api` | `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `apps/api` | `npm run cli -- sync` | Run every connector over the last 7 days |
| `apps/api` | `npm run cli -- seed` | Replace the demo apps with freshly generated data |
| `apps/web` | `npm run typecheck` | Type check |
| `apps/web` | `npm run build` then `npm run start` | Production build and server |

The UI is built from [shadcn/ui](https://ui.shadcn.com) components in
`apps/web/src/components/ui`, themed by the tokens in `apps/web/src/styles.css`. Add one with
`npx shadcn@latest add <name>` from `apps/web`.

Each connector's base URL can be pointed at a stand-in for testing, for example
`TIKTOK_API_URL`, `META_GRAPH_URL`, `GOOGLE_STORAGE_URL` and `REVENUECAT_API_URL`.

## License

[MIT](LICENSE)
