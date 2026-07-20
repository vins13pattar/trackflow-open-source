# TrackFlow jobs scheduler. A small always-on machine that runs the maintenance
# jobs (rollup, retention, subscription expiry, weekly report, notify-retry,
# ingest-health) on intervals and exposes /health + /metrics. Build context is
# the repo root:
#   fly deploy --config fly.jobs.toml
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --filter @trackflow/jobs...

ENV NODE_ENV=production
ENV JOBS_HTTP_PORT=9101
EXPOSE 9101
CMD ["pnpm", "--filter", "@trackflow/jobs", "start"]
