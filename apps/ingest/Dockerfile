# TrackFlow ingest (TCP protocol servers). Always-on on Fly.io — GPS devices
# hold long-lived TCP connections. Build context is the repo root:
#   fly deploy --config fly.ingest.toml
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --filter @trackflow/ingest...

ENV NODE_ENV=production
EXPOSE 5023 5013 5027 5004 5073 5020 9100
CMD ["pnpm", "--filter", "@trackflow/ingest", "start"]
