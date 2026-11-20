# AppDashboard

One dashboard for a portfolio of mobile apps: organic social views, store downloads and revenue
on one page. The plan, decisions and current status are in [PLAN.md](PLAN.md).

## Layout

| Folder | What it is |
|---|---|
| `apps/api` | Fastify + tRPC + Drizzle. The only app that touches Postgres. Also the CLI that cron runs. |
| `apps/web` | TanStack Start dashboard. Its server functions call the API; the browser never does. |

The two apps are independent npm packages. Each installs, builds and deploys on its own.

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

## Commands

| Where | Command | What it does |
|---|---|---|
| `apps/api` | `npm test` | Unit tests |
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
| Env variables | `INTERNAL_API_TOKEN` | `API_URL`, `INTERNAL_API_TOKEN`, `SESSION_SECRET`, `DASHBOARD_PASSWORD` |
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
- Both apps listen on `PORT` when it is set and on 3000 otherwise, over IPv4.
