# TrackFlow API (Hono). Runs on Fly.io as a scale-to-zero container.
# Build context is the REPO ROOT (the pnpm workspace). Deploy with:
#   fly deploy --config fly.api.toml
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

RUN corepack enable
WORKDIR /app

# Copy the whole monorepo (the .dockerignore trims node_modules/build output),
# then install just the API and its workspace dependencies. tsx runs the TS
# entry directly, so there's no separate build step.
COPY . .
RUN pnpm install --frozen-lockfile --filter @trackflow/api...

ENV NODE_ENV=production
ENV API_PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@trackflow/api", "start"]
