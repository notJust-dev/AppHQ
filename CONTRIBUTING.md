# Contributing to AppHQ

Thanks for helping. Bug reports, fixes and new connectors are all welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce.
- **Features and new connectors:** open an issue first, so we can agree on the approach before
  you spend time on it.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

## Running it locally

The [README](README.md) covers setup: Postgres through `docker compose`, `apps/api` and
`apps/web`, each with its own `.env` copied from `.env.example`. Never commit a `.env` file or
real credentials.

[AGENTS.md](AGENTS.md) lists what must never reach this repository: secrets, deployment details,
real data and working notes. Coding agents read it by themselves. If you write by hand, read it
once.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep each pull request to one change, and describe what it does and how you tested it.
3. Run `npm run typecheck` in each app you changed, and the API tests if you changed `apps/api`.
4. Open the pull request against `main`.

Merging to `main` doesn't release your change straight away. The maintainer deploys to
`apphq.io` separately.

## License

AppHQ is licensed under [AGPL-3.0](LICENSE). By opening a pull request, you agree that your
contribution is licensed under the same terms.
