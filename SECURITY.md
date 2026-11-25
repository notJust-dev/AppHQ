# Security policy

AppHQ holds App Store, Google Play, RevenueCat and social account credentials, so security
reports matter to us. Thank you for taking the time.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

- Preferred: [report it privately on GitHub](https://github.com/notJust-dev/AppHQ/security/advisories/new).
- Or email **support@notjust.dev** with "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. We'll reply
within a few days, keep you updated while we fix it, and credit you in the advisory if you'd like.

## Scope

In scope: the code in this repository, and the hosted instance at `apphq.io`.

Out of scope: problems that need an already compromised server or `.env` file, denial of service
by volume, missing security headers with no concrete impact, and reports from automated scanners
without a working proof.

Please don't access other people's data, and don't run tests that could degrade `apphq.io` for
others.

## Supported versions

Only the latest commit on `main` is supported. If you self-host AppHQ, keep your copy up to date.
