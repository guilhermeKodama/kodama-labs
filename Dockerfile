# Single multi-stage Dockerfile for the whole monorepo. One image per app,
# selected at build time with `docker build --target <app>`. All targets
# share the `base` layer (full workspace install + prisma generate), so
# rebuilding one app after editing another's source reuses Docker's layer
# cache instead of reinstalling node_modules from scratch.
#
# Workers run `tsx` against `src/` directly (no compile step), so the image
# needs the full repo + node_modules regardless of `output: standalone` —
# standalone would add a second copy rather than replace anything here.

FROM node:24-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/careers/package.json apps/careers/package.json
COPY apps/attention/package.json apps/attention/package.json
COPY apps/capital/package.json apps/capital/package.json
COPY apps/sentinel/package.json apps/sentinel/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/kodamalabs/package.json apps/kodamalabs/package.json
COPY infrastructure/ infrastructure/
COPY packages/ packages/
COPY ideas/ ideas/
# --ignore-scripts: skips dev-only lifecycle hooks that assume a full working
# tree or a .git dir (apps/docs' fumadocs-mdx postinstall needs source.config.ts,
# which isn't copied yet at this layer; husky's prepare needs .git, excluded by
# .dockerignore). Prisma client generation happens explicitly below instead.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @wallex/careers exec prisma generate \
 && pnpm --filter @wallex/attention exec prisma generate \
 && pnpm --filter @wallex/capital exec prisma generate \
 && pnpm --filter @wallex/sentinel exec prisma generate

# ---------------------------------------------------------------------------
FROM base AS careers
# Next.js inlines NEXT_PUBLIC_* into the client bundle at build time — must
# be ARGs, not just runtime `environment:` in compose, or they ship empty.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN cd apps/careers && pnpm exec next build
WORKDIR /repo/apps/careers
ENV PORT=3006
CMD ["pnpm", "start"]

# ---------------------------------------------------------------------------
FROM base AS attention
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN cd apps/attention && pnpm exec next build
RUN cd apps/attention && pnpm run worker:whatsapp:build
WORKDIR /repo/apps/attention
ENV PORT=3005
CMD ["pnpm", "start"]

# ---------------------------------------------------------------------------
FROM base AS capital
RUN cd apps/capital && pnpm exec next build
WORKDIR /repo/apps/capital
ENV PORT=3000
CMD ["pnpm", "start"]

# ---------------------------------------------------------------------------
FROM base AS sentinel
RUN cd apps/sentinel && pnpm exec next build
WORKDIR /repo/apps/sentinel
ENV PORT=3002
CMD ["pnpm", "start"]
