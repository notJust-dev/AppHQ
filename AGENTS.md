# Rules for coding agents

AppHQ is a public, open source repository. Setup and commands are in [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). This file covers the mistake that is easiest to make here and
can't be undone: publishing something private.

These rules apply to people too.

## Everything in git is public, permanently

Whatever reaches a commit is published to the world, and it stays in history after a later commit
removes it. That covers file contents, file names, commit messages, branch names, tags, and the
text of pull requests, issues and comments.

The test for every line: **would this be fine on the project's front page?** If not, it doesn't
go into git in any form.

This file is public as well. Private context for an agent goes in `CLAUDE.local.md` or in
`.local/`, which are both git-ignored.

## Never put these in the repository

- **Secrets.** `.env` files, API keys, OAuth client secrets, access and refresh tokens, session
  secrets, passwords, encryption keys, and key files (`.p8`, `.pem`, `.p12`, service account
  `.json`). Not in code, tests, docs, examples or comments, and not "for now".
- **Deployment details.** Server and application ids, the address of any deployment other than
  `apphq.io`, IP addresses, connection strings, hosting account names, and which secrets are set
  where. Naming an environment variable is fine. Its value never is.
- **Real data.** Real revenue, download or view numbers, account handles, store or RevenueCat
  ids, review text, user or waitlist emails, and real API responses saved as fixtures.
- **Machine details.** Absolute paths such as `/Users/...`, usernames, personal email addresses,
  and agent or editor session files.
- **Working notes.** Plans, task lists, deployment logs, research notes, runbooks for a one-off
  migration, investigation write-ups and conversation transcripts.

## Plans and notes stay out of git

Don't create a plan, notes or status file in the repository unless the maintainer asks for that
file by name. For a scratch file, use `.local/` at the repository root or a folder outside the
repository.

Committed documentation describes how the software works and how anyone can run it. It never
records what was done to the maintainer's own deployment or accounts.

## When a session can reach real systems

A session may be able to read a local `.env`, call the Cloudways MCP server, or query a database
with real data. What it reads there stays in the session.

- Read `.env.example` for variable names. Open a real `.env` only when the task needs a value
  from it.
- Don't copy values, ids or addresses from tool output into a file, a commit message or pull
  request text.
- Don't paste raw command output or logs into the repository or a pull request. Keep the lines
  that matter and replace ids, hosts and tokens with placeholders.

## Examples, tests and screenshots

- Docs use placeholders: `<your-token>`, `https://apphq.example.com`, `<api address>`.
- Tests and fixtures use invented names, ids and numbers. A test token says what it is, for
  example `test-token-that-is-at-least-32-characters`.
- Screenshots and recordings use the demo data (`npm run cli -- seed` in `apps/api`, ids start
  with `demo-`) or have privacy mode on.

## Before every commit

1. Stage files by name. Don't use `git add -A` or `git add .`.
2. Read `git diff --staged` in full, new files included, against the list above.
3. Check `git status` for files that shouldn't exist: `.env*`, key files, plans, dumps, logs.
4. Put the commit message, branch name and pull request text through the same test.

Never add an ignored file with `git add -f`, and never loosen `.gitignore` to get a file in.

## If something private was committed

Stop and tell the maintainer straight away: what it is, which commit, and whether it was pushed.
Don't fix it quietly.

- Deleting it in a new commit doesn't take it out of history.
- Don't rewrite history or force-push by yourself.
- A secret that was pushed is compromised. It has to be rotated, whatever happens to the commit.

## Security problems

Don't describe an unfixed vulnerability in a public issue, pull request or commit message.
[SECURITY.md](SECURITY.md) has the private route.
