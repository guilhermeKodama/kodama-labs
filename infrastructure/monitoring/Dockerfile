# Small runtime image for the provisioner and the log watcher.
# Build context is the repo root (the lockfile is a workspace lockfile).

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @infrastructure/monitoring... --ignore-scripts \
 && pnpm --filter @infrastructure/monitoring run build \
 && pnpm --filter @infrastructure/monitoring deploy --prod --ignore-scripts /out

FROM node:24-slim
WORKDIR /app
COPY --from=build /out /app
COPY infrastructure/cronjobs/schedules /app/schedules
ENV CRON_SCHEDULES_DIR=/app/schedules
ENV NODE_ENV=production
CMD ["node", "dist/provision.js"]
