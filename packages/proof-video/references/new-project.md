# Adding proof videos to a project

Read this when a project has no `proof/` folder yet. The tool is the same everywhere; how the app starts, where its data comes from and when a video is required are the project's own.

## What the machine needs

- Node 20 or newer.
- `ffmpeg` and `ffprobe` with H.264 support, on `PATH` (macOS: `brew install ffmpeg`).
- Playwright's Chromium: `pnpm exec playwright install chromium`, once per machine.
- To attach videos to pull requests from the command line: a `gh` that has `--attach` (2.102 does).

## 1. Bring the tool in

This folder is the whole tool: `package.json`, `src/`, this skill. Copy it into the project.

- In a workspace, put it where shared packages live (`packages/proof-video`) and add it to the app:

  ```json
  "devDependencies": {
    "@playwright/test": "1.64.0",
    "@repo/proof-video": "workspace:*"
  }
  ```

  Keep `@playwright/test` at the version in this folder's `package.json`: the recorder relies on `page.screencast`, which needs 1.64 or newer.
- In a single-package project, put it in `tools/proof-video` and import it by relative path.

The source is TypeScript and is not built: Playwright loads it directly.

## 2. Decide the environment

Answer these before writing code. The answers become the app's `proof/` files.

| Question | Why it matters |
|---|---|
| How does the app start locally, and on which port? | Two checkouts recording at once must not film each other. `checkoutPort(dir)` gives a port that is stable for one checkout. |
| Which database does a recording use? | It writes demo data and runs the branch's migrations, so it needs one of its own. `proofDatabaseUrl(devUrl, app, checkoutSlug(dir))` derives `<app>_proof_<checkout>_dev` on the same local server, and refuses a server that is not local. |
| How is demo data created? | Every run should start from the same known data. Reuse the project's seed. |
| How does a flow sign in? | Sign in once in setup, save the session, and let flows start signed in. Film the sign-in page in one flow only. |
| Which outside services does the app call? | Switch them off for the proof server (empty keys). The recorder blocks HTTP calls from the page to any host outside this machine and fails the flow, so an app that needs one must list it in `proof.allowedHosts`. It does not see calls the server makes. |
| Where do the app's own toasts appear? | Put captions on the other edge (`proof.captions`). |

## 3. Write the app's proof folder

```
<app>/proof/
  playwright.config.ts   defineProofConfig({...})
  setup.ts               database, seed, sign-in, warm-up; runs once per run
  server.ts              starts the app for proof runs (only if it needs its own port, database or environment)
  env.ts                 the port, database and environment shared by the three files above
  helpers.ts             app-specific helpers for flows; starts empty
  flows/                 the suite that always runs
  once/                  proofs of a single change
  tsconfig.json          so the folder is typechecked on its own
```

`playwright.config.ts`:

```ts
import path from "node:path";
import { defineProofConfig } from "@repo/proof-video";

export default defineProofConfig({
  dir: __dirname,
  baseURL: "http://localhost:3210",
  webServer: { command: "pnpm proof:server", url: "http://localhost:3210/login", reuseExistingServer: true, timeout: 300_000 },
  globalSetup: path.join(__dirname, "setup.ts"),
  storageState: path.join(__dirname, "out", "session.json"),
  proof: { captions: "top", hideSelectors: ["nextjs-portal"] },
  meta: { app: "my-app" },
  rerun: "pnpm --filter my-app proof:record",
});
```

`defineProofConfig` sets what every proof run shares: one worker, no retries, Playwright's own video and trace off, service workers blocked. Its other options:

| Option | Meaning |
|---|---|
| `dir` | The proof folder. Flows in `dir/flows`, one-off proofs in `dir/once`, results in `dir/out`. |
| `outDir` | Another results folder, for example one per agent slot. |
| `webServer` | How Playwright starts the app, or attaches to one already running. |
| `globalSetup` | A file that prepares data and the session. It may return a function that cleans up. |
| `storageState` | The saved session flows start with. |
| `locale`, `timezoneId`, `viewport` | Browser settings. The viewport is also the size of the video. |
| `proof.captions` | `"top"` or `"bottom"`. |
| `proof.allowedHosts` | Hosts the page may call besides the app. |
| `proof.hideSelectors` | Elements hidden in every flow, such as a framework's dev badge. |
| `proof.terminalEnv` | Variables every `terminal()` command gets. Put the proof database here, so a recorded command cannot reach the shared one. |
| `proof.secrets` | Strings `terminal()` never shows, such as the values in the app's `.env`. |
| `meta` | Pairs shown in the manifest, the closing card and the pull request text. |
| `rerun` | The command printed as "Record again". |
| `maxVideoBytes` | The upload limit to fit under. Default 10 MB. |

Package scripts:

```json
"proof": "playwright test -c proof/playwright.config.ts",
"proof:record": "PROOF_RECORD=1 playwright test -c proof/playwright.config.ts",
"proof:once": "PROOF_ONCE=1 PROOF_RECORD=1 playwright test -c proof/playwright.config.ts",
"proof:server": "tsx proof/server.ts"
```

`setup.ts` rules worth keeping:

- Assert the database before the first write: `assertProofDatabase(url, app)` has no override.
- Give the demo user a new random password each run and pass it through the environment. Never write it to a file or a log.
- Open each main page once before the flows, so first-load compilation never appears on video.
- Delete the saved session when the run ends.

Keep `proof/out` out of git and out of Docker build contexts. Typecheck `proof/` with its own `tsconfig.json` and exclude it from the app's, so the production build never depends on proof code.

## 4. A worked example

In the kodama-labs repository, `apps/capital/proof/` is a complete setup: a dev server on a per-checkout port, a per-checkout Postgres database migrated on demand, the project's demo seed with a random password, sign-in through the API, and slots for agents working in parallel. Read it before writing your own.

## 5. Write the project's rule

Put it where every agent reads it (`AGENTS.md`, imported from `CLAUDE.md`). Decide, and write down:

- when a video is required (every pull request? only changes to the interface?);
- what it must show;
- where it goes (the pull request, a chat, both);
- what to do when a recording is not possible.

Then write the first flow, record it, and open the frames.
