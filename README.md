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
dashboard is protected by a single password. Optionally, people can sign in with Google or GitHub,
or sign up with an email address; once you approve them, their account opens the dashboard in
their own organization, and you can turn the password off (see
[Accounts and access requests](#accounts-and-access-requests-optional)).

## How it works

```
Browser ──▶ web (TanStack Start)  ──internal token──▶  api (Fastify + tRPC)  ──▶ PostgreSQL
            login, dashboard UI,                       connectors, scheduled
            server functions,                          syncs, migrations,
            /api/auth forwarding                       accounts (Better Auth)
```

| Folder | What it is |
|---|---|
| `apps/api` | Fastify + tRPC + Drizzle. The only part that touches Postgres. Runs the data syncs on a schedule and applies migrations when it boots. Also includes a small CLI. |
| `apps/web` | TanStack Start dashboard (React, Vite, shadcn/ui). Its server functions call the API with a shared secret, so the browser never talks to the API directly. It also forwards account sign-ins to the API, so their cookie stays on the dashboard's own domain. |

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
| `apps/web/.env` | `DASHBOARD_PASSWORD` | The password you will sign in with, 12+ characters. Optional once accounts are on; see [Turning the dashboard password off](#turning-the-dashboard-password-off) |

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
in the `waitlist` table). The dashboard itself is always at `/login` and behind sign-in.

## Deploy to Cloudways Velocity

[Cloudways Velocity](https://unified.cloudways.com/signup?id=2228590&data1=notjustdev&data2=sponsorship) runs always-on Node.js apps
deployed from GitHub, which suits AppHQ: the API keeps running between requests, so it can sync
your data on a schedule. Both apps and the database fit on one Starter server.

You will create **two Velocity applications from the same repository**: `api` (with
PostgreSQL attached) and `web`.

### 1. Fork the repository

Fork this repository to your GitHub account. Velocity
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
| `ALLOW_DASHBOARD_PASSWORD` | Optional, `true` (the default) or `false`. Whether the API accepts the web app's dashboard password. Set it to `false` only when you sign in with an account instead; see [Turning the dashboard password off](#turning-the-dashboard-password-off) |
| `SENTRY_DSN` | Optional. Turns on error reporting; see [Error reporting](#error-reporting-optional). Leave it unset and nothing is sent anywhere |
| `SENTRY_ENVIRONMENT` | Optional. The environment errors are filed under, default `NODE_ENV` |

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
| `DASHBOARD_PASSWORD` | The password you will sign in with, 12+ characters. Changing it signs out everyone who signed in with the old one. Optional once accounts are on: unset, the password is off |
| `PUBLIC_URL` | Optional. The dashboard's own address, if the sign-in redirect addresses on the Accounts page come out wrong (for example behind a custom domain) |
| `POSTHOG_KEY` | Optional. A PostHog project API key turns on cookieless usage analytics, sent through the app's own `/ingest` path. Leave it unset and nothing is sent anywhere |
| `POSTHOG_HOST` | Optional. Defaults to PostHog's US cloud, `https://us.i.posthog.com`. For the EU cloud, `https://eu.i.posthog.com` |
| `SENTRY_DSN` | Optional. Turns on error reporting from the browser; see [Error reporting](#error-reporting-optional). It can be the same DSN as the API's, or one from a separate project |
| `SENTRY_ENVIRONMENT` | Optional. The environment errors are filed under, default `NODE_ENV` |

Deploy the app, then open `https://<web address>/health`. It reports whether the dashboard is
fully configured and whether it can reach the API, so you can check the setup without
signing in.

### 8. Sign in

Open `https://<web address>/login` and sign in with `DASHBOARD_PASSWORD`. Then go to
**Accounts** to connect your first source.

To look around with demo data first, send this request (with your internal token) to the API.
It loads four made-up apps, marked as demo apps:

```bash
curl -X POST https://<api address>/trpc/demo.seed \
  -H "Authorization: Bearer <INTERNAL_API_TOKEN>" \
  -H "x-apphq-access: dashboard" \
  -H "Content-Type: application/json" -d '{}'
```

Or use **Load demo data** on the Accounts page once you are signed in. Remove them before you
connect real data. The same request to `demo.clear` (or **Remove demo data**) deletes them and
nothing else.

The `x-apphq-access` header is how the dashboard server tells the API that someone signed in with
the dashboard password. The API only accepts it alongside the internal token, and only while
`ALLOW_DASHBOARD_PASSWORD` is on. Without it, a dashboard request needs an approved account.

### 9. (Optional) Custom domains

Add a domain to each application in Velocity, for example `app.example.com` for `web` and
`api.example.com` for `api`. Then update `API_URL` on `web`, set `PUBLIC_URL` on `web` to the
new dashboard address, and update the redirect URIs registered with TikTok, Meta and Google. If
accounts are on, also set `PUBLIC_URL` on `api` to the same new dashboard address and update the
sign-in redirect URIs with Google and GitHub.

### Good to know

- **A push to your deploy branch redeploys both apps**, whichever folder changed. Each restarts
  for a few seconds.
- **Syncs run inside the API**, every `SYNC_EVERY_HOURS`.
- **Both apps listen on `PORT`** when it is set, and on 3000 otherwise, over IPv4. Velocity
  assigns the ports, so you can leave `PORT` unset.

### Or let an AI agent deploy it (Cloudways MCP)

The [Cloudways MCP server](https://support.cloudways.com/en/articles/14654372-how-to-use-cloudways-mcp-server-for-ai-based-server-management)
lets an AI agent such as Claude Code, Cursor or Codex create the server and both apps for you,
following the same steps as above.

**1. Connect GitHub in the Cloudways console** and give Cloudways access to your fork. This step
can't be done through the MCP.

**2. Create a Cloudways access token** for the MCP, as the article above describes.

**3. Add the MCP server to your agent.**

**Claude Code** (the `claude` CLI, and the Code tab in the Claude desktop app) connects to it
directly:

```bash
claude mcp add --transport http --header "X-Access-Token: <your-cloudways-access-token>" --header "X-Mcp-Host: claude-code" -s user cloudways https://mcp.cloudways.com/mcp/
```

Check it with `claude mcp list`.

For Claude Desktop's chat, Cursor, VS Code, Gemini CLI, Codex and others, see the
[Cloudways article](https://support.cloudways.com/en/articles/14654372-how-to-use-cloudways-mcp-server-for-ai-based-server-management).

**4. Ask the agent to deploy**, from a session started in your fork so it can read this README:

```text
Deploy this repository to Cloudways Velocity, following "Deploy to Cloudways Velocity" in
README.md. Create a Starter Velocity server, then two applications from my fork's main branch:
"api" (root directory apps/api, the Other framework preset, build command npm run build, start
command npm run start, with PostgreSQL attached) and "web" (root directory apps/web, the
TanStack SSR preset). Set the environment variables the README lists for each app. Do not set
NODE_ENV. List everything you are about to create and wait for my OK before each create call.
When both are deployed, check /health on both apps.
```

Good to know:

- **Check the API's framework preset.** If the API app is created with the Fastify preset, the
  build command is dropped and the TypeScript never compiles. Ask the agent to switch it to
  **Other**.
- **Secrets pass through the agent.** Whatever you ask it to set as an environment variable is in
  its conversation. If you prefer, let the agent create the apps and paste `INTERNAL_API_TOKEN`,
  `ENCRYPTION_KEY`, `SESSION_SECRET` and `DASHBOARD_PASSWORD` into Velocity yourself.
- **The MCP can also delete servers and apps**, and deletion can't be undone. Your token has full
  access to the account, so keep it private and review what the agent proposes before you approve it.

## Accounts and access requests (optional)

If you want to sign in with your own account, or let other people ask for access, turn on
accounts: the sign-in page (`/login`) then offers **Continue with Google** and **Continue with
GitHub** above the dashboard password, and people who sign in that way land on a page where they
can press **Request access**. With a mail server, people can also
[sign up with an email address and a password](#signing-up-with-an-email-address). This is off
unless you set it up, and nothing else changes when it is off.

An account opens the dashboard when all of these hold:

- its address is confirmed: by the provider, or with the code emailed at sign-up,
- you approved it (step 3 below),
- it is a member of an organization. Approval makes it one of its own; `add-owner` adds it to
  yours (see [Organizations](#organizations)).

It then works in that organization only, and never sees another's data. The dashboard password
keeps working alongside, in the `default` organization, until you turn it off.

**1. Create the sign-in apps.** Use the dashboard's address (the `web` app, not the API), shown
here as `<web address>`; locally it is `http://127.0.0.1:3000`.

- **Google:** use the same Google Cloud project as YouTube, with a second **OAuth client** of type
  **Web application** for sign-in. Add the authorized redirect URI
  `<web address>/api/auth/callback/google`. The two clients share one consent screen, but each
  asks only for its own permissions: signing in asks for name and email, and YouTube's
  permissions are asked for only when someone presses **Connect YouTube**, with whichever Google
  account owns the channel. While the consent screen is in **Testing**, only its test users can
  sign in, so publish it before you open sign-up (Google reviews the YouTube permissions first).
- **GitHub:** in **Settings → Developer settings → OAuth Apps**, create an app with the
  authorization callback URL `<web address>/api/auth/callback/github`.

You can set up just one of them, or neither if people will only
[sign up with an email address](#signing-up-with-an-email-address).

**2. Set the variables on the `api` app** and redeploy. Nothing new is needed on `web`.

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | A new `openssl rand -hex 32` value. Changing it signs everyone out |
| `PUBLIC_URL` | `<web address>`, with no path: the dashboard's address, not the API's. The same value as `PUBLIC_URL` on `web` |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | From the Google OAuth client |
| `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` | From the GitHub OAuth App |

The API's log says `accounts are on` when it boots, and `/login` shows the sign-in buttons.

**3. See who asked**, in the database (for example with `psql`):

```sql
select email, name, access_status, access_requested_at from "user"
order by access_requested_at desc nulls last;
```

To approve someone: `update "user" set access_status = 'approved' where email = '<their address>';`
The next time they sign in or open the Request access page, the API makes them an organization
of their own (see below), with a generated name and slug, unless they already belong to one, and
they go on to the dashboard, empty and theirs. Someone who only asked gets none.

Only confirmed addresses can sign in, and an address has one way in: someone who signed in with
Google can't later sign in to the same account with GitHub or give it a password, even with the
same address.

### Signing up with an email address

With a mail server, `/login` also takes an email address and a password, and links to **Create an
account** (`/sign-up`) and **Forgot password?**. It works next to Google and GitHub, or without
them.

- **Signing up.** The person enters an address and a password, gets a 6-digit code by email and
  enters it. Only then is the account made, so no account exists for an address nobody confirmed,
  and the database does not hold the address until then. The code works for 10 minutes and
  survives a few wrong guesses.
- **Resetting a password.** The person gets a link that works once, for 60 minutes. Choosing a
  new password signs the account out everywhere and emails its owner that the password changed.
- **Passwords** are at least 8 characters and are stored hashed.
- **One way in per address.** Signing up with an address that already has an account emails its
  owner to say so, instead of a code. An account made with Google or GitHub gets no password,
  and an account with a password can't sign in with Google or GitHub.
- **Approval is unchanged.** A new account lands on the Request access page, and opens nothing
  until you approve it (step 3 above).
- **Limits.** Signing in, signing up and resetting are limited per visitor, and one address is
  emailed at most 5 times an hour, so the forms can't be used to fill someone's inbox.

Any mail provider with an SMTP server works. Verify your sending domain with it first; it gives
you the SPF and DKIM records to add to your DNS. Then set these on the `api` app, next to
`BETTER_AUTH_SECRET` and `PUBLIC_URL` from step 2 above, and redeploy:

| Variable | Value |
|---|---|
| `SMTP_HOST` | The provider's SMTP server, for example `smtp.example.com` |
| `SMTP_PORT` | Optional. Default `465` |
| `SMTP_TLS` | Optional: `implicit` (TLS from the start, port 465), `starttls` (port 587) or `none`. Default: by the port. `none` is refused for any server but one on the same machine |
| `SMTP_USER`, `SMTP_PASSWORD` | The SMTP login the provider gives you |
| `MAIL_FROM` | The sender, for example `AppHQ <no-reply@apphq.example.com>`, on the domain you verified |
| `MAIL_REPLY_TO` | Optional. Where replies go, when that is not the sender |

With [Resend](https://resend.com), for example: host `smtp.resend.com`, port `465`, user `resend`,
and an API key as the password. Make the key with sending access only, for your domain alone.

The API's log says `signing up with an email address is on` when it boots, and `/login` shows the
form. The emails are plain: text with one code or one link, no images and nothing that tracks
opens. Leave your provider's open and click tracking off too.

**Try it locally** without sending real mail. Start the mail catcher that comes with the compose
file:

```bash
docker compose --profile mail up -d
```

Add this to `apps/api/.env` and restart the API:

```bash
BETTER_AUTH_SECRET=<openssl rand -hex 32>
PUBLIC_URL=http://127.0.0.1:3000
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_TLS=none
MAIL_FROM=AppHQ <no-reply@apphq.example.com>
```

Every message the API sends then shows up at http://127.0.0.1:8025 instead of being delivered.

### Organizations

Every app, account connection, number, post, review and sync run belongs to an **organization**.
The first one, `default`, was made when you upgraded and holds everything you had; the dashboard
password works in it. Approved accounts get their own, empty organization. An approved account
works in an organization it is a member of: the one it last worked in, or else the one it joined
first. The sidebar shows which, under the AppHQ name. Every member can do everything there.
Nobody can create, join or switch organizations through the sign-in pages.

**Make your own account the owner of `default`**, so it opens your data. Sign in or sign up once
at `/login` first. Then, where you have a shell:

```sh
cd apps/api && npm run cli -- add-owner --email <your address>
```

It also removes the empty organization made for your account on approval, if there is one. On a
host without a shell (such as Velocity), run this SQL instead, before approving yourself:

```sql
insert into member (organization_id, user_id, role)
select o.id, u.id, 'owner' from organization o, "user" u
where o.slug = 'default' and u.email = '<your address>'
on conflict (organization_id, user_id) do update set role = 'owner';

update "user" set access_status = 'approved' where email = '<your address>';

-- Only if you were approved before running the statement above: removes the empty organization
-- made for your account. It fails, and changes nothing, if that organization holds any data.
delete from organization o using "user" u
where u.email = '<your address>'
  and o.slug = 'org-' || left(encode(sha256(u.id::text::bytea), 'hex'), 12)
  and not exists (select 1 from member m where m.organization_id = o.id and m.user_id <> u.id);
```

With a shell, approve yourself with the `update "user"` statement above too.

### Turning the dashboard password off

Once your account opens your data, you can switch the password off. There are two switches, so a
password left behind by mistake still opens nothing:

| Where | Variable | Off |
|---|---|---|
| `web` | `DASHBOARD_PASSWORD` | Unset (or empty): `/login` shows no password field, and signing in with a password is refused before anything is compared |
| `api` | `ALLOW_DASHBOARD_PASSWORD` | `false`: the API refuses the web app's password sessions, even if `DASHBOARD_PASSWORD` is still set there. Default `true`, so existing installs keep working |

Do it in this order, so you never lock yourself out:

1. **Make your account an owner of `default` and approve it**, as above.
2. **Sign out, sign in with your account, and check.** You should land on the dashboard,
   see `Default organization` under the AppHQ name in the sidebar, and see your apps.
3. **Set `ALLOW_DASHBOARD_PASSWORD=false` on `api`** and redeploy it. Check again that your
   account still opens the dashboard. Password sessions stop working now.
4. **Unset `DASHBOARD_PASSWORD` on `web`** and redeploy it. The password field disappears.

To turn it back on, set both again. Changing `DASHBOARD_PASSWORD` (or `SESSION_SECRET`) signs
out every password session at once.

With neither the password nor accounts set up, nobody can open the dashboard; the API says so in
its log when it starts.

### Row-level security

Under the code's own filters, Postgres keeps each organization's rows apart too. Every table
with an `organization_id` has a row-level security policy, and the API reads and writes them only
in short transactions that name one organization: a query sees and changes that organization's
rows and nothing else, and one that names none sees nothing. A write can't point at another
organization's app, account or post either.

When the API starts it checks this holds, and refuses to start, saying why, when it doesn't. The
database login needs one of these:

- **It may create roles** (a superuser, or `CREATEROLE`, as with the local Docker database). The
  API then makes a role `apphq_tenant` that can't log in or bypass row-level security, and runs
  every request and sync as it.
- **It owns the tables and is neither a superuser nor has `BYPASSRLS`**, as is usual on managed
  hosts. Requests then run as the login itself, which the policies hold too.

To use the separate role on a host where the login can't create it, have someone who can run
this once, then restart the API:

```sql
create role apphq_tenant nologin;
grant apphq_tenant to <the api's database user>;
```

## Error reporting (optional)

Both apps can report errors to [Sentry](https://sentry.io), or to anything that accepts Sentry's
protocol, such as [GlitchTip](https://glitchtip.com) or a self-hosted Sentry. It is off unless
`SENTRY_DSN` is set, on the `api` application, the `web` application, or both. The setting is
read when the app starts, so turning it on needs a restart but no rebuild.

- **The API** reports server errors from its routes, failed syncs (tagged with the source), and
  crashes.
- **The dashboard** reports errors in the browser, including the ones that show the "could not
  load" page.

Only an error's message and stack trace are sent, with the route, source or page address it came
from. Query strings, fragments, request and response bodies, headers, cookies, local variables,
console output and user details are left out, because they can hold OAuth tokens, API keys and
your numbers. There is no performance tracing and no session replay.

Browser extensions that block ads may block reports sent straight to sentry.io.

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

TikTok sometimes answers for a video without its view count, or with zero. AppHQ asks for that
video again and, when there is still no count to believe, keeps what it has stored and says so
in the API's log. A total that dips and comes back is counted once.

### Facebook Pages and Instagram

1. Create an app at [developers.facebook.com](https://developers.facebook.com), owned by your
   business portfolio, with the use cases **Manage everything on your Page** and **Manage
   messaging & content on Instagram**.
2. Add the redirect URI shown on AppHQ's Facebook and Instagram page.
3. Create a **Facebook Login for Business** configuration for Pages and Instagram accounts with
   `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `read_insights`,
   `instagram_basic` and `instagram_manage_insights`. A system-user token, which Unified login
   gives, and a user token both work.
4. Set `META_APP_ID`, `META_APP_SECRET` and `META_LOGIN_CONFIG_ID` on the API and redeploy.

One sign-in finds every Page you manage and the Instagram accounts linked to them. Facebook
brings a year of daily insights, and Instagram brings 90 days. Meta's sign-in lasts about 60 days, so
sign in again before the date shown on the page.

### YouTube

1. In Google Cloud, enable the **YouTube Data API v3** and the **YouTube Analytics API**.
2. Create an **OAuth client** of type **Web application**. Its consent screen needs the
   `youtube.readonly` and `yt-analytics.readonly` scopes. Add yourself as a test user while
   the app is in testing. If you also turn on [accounts](#accounts-and-access-requests-optional),
   their Google sign-in goes in this same project, as a second client.
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
| `apps/api` | `npm test` | Unit tests. With `TEST_DATABASE_URL` set (database name ending in `_test`, a login that may create roles), also the Postgres tests |
| `apps/api` | `npm run typecheck` | Type check |
| `apps/api` | `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `apps/api` | `npm run cli -- sync` | Run every connector over the last 7 days, for every organization |
| `apps/api` | `npm run cli -- seed` | Replace the demo apps with freshly generated data, in `default` |
| `apps/api` | `npm run cli -- add-owner --email <address>` | Make an account an owner of `default`; once approved, it opens the dashboard there |

Every CLI command but `migrate` also takes `--organization <slug>`.
| `apps/web` | `npm test` | Unit tests of the dashboard server's password rules and of what analytics and error reports may send |
| `apps/web` | `npm run typecheck` | Type check |
| `apps/web` | `npm run build` then `npm run start` | Production build and server |

The UI is built from [shadcn/ui](https://ui.shadcn.com) components in
`apps/web/src/components/ui`, themed by the tokens in `apps/web/src/styles.css`. Add one with
`npx shadcn@latest add <name>` from `apps/web`.

Each connector's base URL can be pointed at a stand-in for testing, for example
`TIKTOK_API_URL`, `META_GRAPH_URL`, `GOOGLE_STORAGE_URL` and `REVENUECAT_API_URL`.

## License

AppHQ is licensed under the [GNU Affero General Public License v3.0](LICENSE). You can use,
change and self-host it freely. If you run a modified version as a service for other people,
you must publish your changes under the same license.

The AppHQ name and logo are not covered by the code license. Please don't use them for your own
hosted version or fork.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Disclosure

The Cloudways links in this README are affiliate links. If you sign up through them, I may earn
a commission at no extra cost to you.
