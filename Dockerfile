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

# All 4 apps validate env eagerly via @t3-oss/env-nextjs at module-import
# time, which next build triggers while collecting page data — long before
# any real secret is available (those come from compose env_file: at
# container start; .dockerignore deliberately keeps .env.production out of
# this image). Every field but two has a schema .default(), so real
# validation is left ON (SKIP_ENV_VALIDATION would strip those defaults too,
# not just the required-field check, causing more failures than it fixes).
# The only two fields with no default anywhere across the 4 apps:
# attention's VAPID_PRIVATE_KEY (server-only, never reaches a client bundle —
# safe as a throwaway build-time value) and NEXT_PUBLIC_VAPID_PUBLIC_KEY,
# which is already supplied correctly per-target as a real build ARG below.
# web-push validates the key decodes to exactly 32 bytes, so it must be a
# syntactically-real (but not the actual secret) VAPID-shaped value — this
# one is freshly random, unrelated to the real key injected at runtime.
ENV VAPID_PRIVATE_KEY="AI_lg0JA7DY9SIzNWl7gUarPNnnLaidU7lE-W2-vuyo"

# Separately: every app instantiates `new PrismaClient()` at module scope in
# a lib file, so merely importing it — which next build does for every
# route while collecting page data, dynamic or not — constructs the client
# immediately. Prisma reads DATABASE_URL/DIRECT_URL straight from
# process.env (schema.prisma's env("DATABASE_URL")), bypassing the
# t3-env layer entirely, and validates the URL string at construction time
# (not query time) — so these need a real placeholder too, independent of
# the schema defaults above.
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
ENV DIRECT_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"

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
# Next.js inlines NEXT_PUBLIC_* into the client bundle at build time — must
# be an ARG, not just runtime `environment:` in compose, or the subscribe
# flow ships with an empty VAPID key and silently no-ops.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN cd apps/capital && pnpm exec next build
WORKDIR /repo/apps/capital
ENV PORT=3000
# Explicit rather than relying on `next start` to infer it. capital's
# src/server/lib/db-guard.ts refuses to connect to a non-_dev/_test
# database unless NODE_ENV=production, so an unset value here would take
# the container down at startup instead of protecting anything. Set after
# the build so it cannot affect the install/build stages above.
ENV NODE_ENV=production
CMD ["pnpm", "start"]

# ---------------------------------------------------------------------------
FROM base AS sentinel
RUN cd apps/sentinel && pnpm exec next build
WORKDIR /repo/apps/sentinel
ENV PORT=3002
CMD ["pnpm", "start"]
