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

`ideas/` is the validation product line — fast, structured idea testing. Each idea is its own Next.js prototype that ships independently to Vercel, paired with a one-pager (`validation.md`) following the Zero-to-Sold / Lean Startup framework. See [`ideas/README.md`](ideas/README.md) for the playbook. Spin up a new idea with `pnpm new:idea <slug>`.

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
pnpm db:migrate # apply capital + sentinel migrations
pnpm dev:db     # foreground postgres logs (optional)
```

To develop all apps and packages, run the following command:

```
cd my-turborepo
pnpm dev
```

### Remote Caching

Turborepo can use a technique known as [Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching) to share cache artifacts across machines, enabling you to share build caches with your team and CI/CD pipelines.

By default, Turborepo will cache locally. To enable Remote Caching you will need an account with Vercel. If you don't have an account you can [create one](https://vercel.com/signup), then enter the following commands:

```
cd my-turborepo
npx turbo login
```

This will authenticate the Turborepo CLI with your [Vercel account](https://vercel.com/docs/concepts/personal-accounts/overview).

Next, you can link your Turborepo to your Remote Cache by running the following command from the root of your Turborepo:

```
npx turbo link
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turbo.build/repo/docs/core-concepts/monorepos/running-tasks)
- [Caching](https://turbo.build/repo/docs/core-concepts/caching)
- [Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching)
- [Filtering](https://turbo.build/repo/docs/core-concepts/monorepos/filtering)
- [Configuration Options](https://turbo.build/repo/docs/reference/configuration)
- [CLI Usage](https://turbo.build/repo/docs/reference/command-line-reference)
