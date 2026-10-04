# Turborepo starter

This is an official starter Turborepo.

## Requirements

- **Node.js 24** (LTS) - Use `nvm use` to automatically switch if you have nvm installed

## Using this example

Run the following command:

```sh
npx create-turbo@latest
```

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `docs`: a [Next.js](https://nextjs.org/) app
- `web`: another [Next.js](https://nextjs.org/) app
- `@repo/ui`: a stub React component library shared by both `web` and `docs` applications
- `@repo/eslint-config`: `eslint` configurations (includes `eslint-config-next` and `eslint-config-prettier`)
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

### Ideas (validation prototypes)

`ideas/` is the validation product line — fast, structured idea testing. Each idea is its own Next.js prototype, paired with a one-pager (`validation.md`) following the Zero-to-Sold / Lean Startup framework. See [`ideas/README.md`](ideas/README.md) for the playbook. Spin up a new idea with `pnpm new:idea <slug>`.

### Dev ports

Every Next app is pinned to a fixed port so `pnpm dev` doesn't silently auto-bump and collide.

| App | Port |
|---|---|
| `apps/capital` | 3000 |
| `apps/docs` | 3001 |
| `apps/sentinel` | 3002 |
| `apps/kodamalabs` | 3003 |
| `apps/attention` | 3005 |
| `apps/careers` | 3006 |
| `ideas/*` | 3100 |

Ideas share port 3100 — run one prototype at a time, or pass `next dev --port 3101` to run a second in parallel.

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

### Build 

To build all apps and packages, run the following command:

```
cd my-turborepo
pnpm build
```

### Develop

Local development needs PostgreSQL plus env files for the Prisma apps.

```sh
# 1. Install dependencies (also runs prisma generate via postinstall)
pnpm install

# 2. Copy env templates for apps that use the database
cp apps/capital/.env.example apps/capital/.env
cp apps/sentinel/.env.example apps/sentinel/.env

# 3. Start Postgres and apply migrations
pnpm setup:local

# 4. Run all apps
pnpm dev
```

Postgres runs in Docker on port `5433` (`infrastructure/postgres`). To manage it separately:

```sh
pnpm db:up      # start postgres in the background
pnpm db:migrate # apply capital, sentinel, attention, and careers migrations (`prisma migrate deploy`; not part of `pnpm build`)
pnpm dev:db     # foreground postgres logs (optional)
```

To develop all apps and packages, run the following command:

```
cd my-turborepo
pnpm dev
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turbo.build/repo/docs/core-concepts/monorepos/running-tasks)
- [Caching](https://turbo.build/repo/docs/core-concepts/caching)
- [Filtering](https://turbo.build/repo/docs/core-concepts/monorepos/filtering)
- [Configuration Options](https://turbo.build/repo/docs/reference/configuration)
- [CLI Usage](https://turbo.build/repo/docs/reference/command-line-reference)
