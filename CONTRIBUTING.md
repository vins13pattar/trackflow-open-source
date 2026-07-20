# Contributing to TrackFlow

Thank you for helping improve TrackFlow.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue for substantial behavior or architecture changes before implementing them.
- Never include real device IMEIs, customer locations, credentials, production URLs, or database
  exports in code, tests, screenshots, issues, or pull requests.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report vulnerabilities through the private
  process in [SECURITY.md](SECURITY.md).

## Local setup

TrackFlow requires Node.js 22+, pnpm 10.33.0, Docker, PostgreSQL, and Redis.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm --filter @trackflow/db db:migrate
pnpm --filter @trackflow/db db:rls
```

Run the API, ingest service, and web dashboard in separate terminals with `pnpm api:dev`,
`pnpm ingest:dev`, and `pnpm web:dev`.

## Verification

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level high
```

Changes to the database or tenant authorization must also pass the PostgreSQL-backed RLS tests.
Protocol decoder changes should include framing, malformed-input, and published-vector tests.

## Pull requests

Keep pull requests focused and explain the user-visible impact, security implications, and test
coverage. By contributing, you agree that your contribution is licensed under Apache-2.0.
