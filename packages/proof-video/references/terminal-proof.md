# Proof for a change with nothing to see in the product

Show the change in the product whenever it has any visible effect: a backend fix that changes a number on a screen is proven by a flow on that screen.

When there is nothing to see (a script, a migration, a build or infrastructure change), record the commands and what they printed. `terminal()` runs a real command and streams its output onto the page being recorded, then gives you the exit code and the output to assert on.

## Where it lives

Such a proof belongs to one change and usually cannot be replayed later, so it stays out of the suite that always runs:

- write it in `proof/once/<name>.flow.ts`;
- record it with `pnpm --filter <app> proof:once` (add a file path to pick one);
- the results go to `proof/out/once/`.

Commit the file with the change. It is the record of how the change was proven.

## Example

```ts
import { expect, flow } from "@repo/proof-video";

flow("The recorder only ever writes to a proof database", async ({ scene, say, check, terminal }) => {
  await scene("Database guard", "Nothing to see in the product, so the proof is the commands and their result");

  await say("The recorder's unit tests: database name, checkout port, secret masking");
  const tests = await terminal("pnpm", ["--filter", "@repo/proof-video", "test"]);
  await check("The unit tests pass", async () => {
    expect(tests.code).toBe(0);
    expect(tests.output).toMatch(/Tests\s+\d+ passed/);
  });

  await say("Now the guard itself, asked to use the shared dev database");
  const useSharedDatabase = 'require("@repo/proof-video/environment").assertProofDatabase("postgresql://user:password@localhost:5433/capital_dev", "capital")';
  const refused = await terminal("pnpm", ["--filter", "@wallex/capital", "exec", "tsx", "-e", useSharedDatabase]);
  await check("It refuses and exits with an error", async () => {
    expect(refused.code).not.toBe(0);
    expect(refused.output).toContain('Refusing the database "capital_dev"');
  });
});
```

The second half is the part that matters: the passing tests say the guard is tested, and the refused command shows the guard working.

## What makes it proof

- **Run the real command**, the one a person would run. Do not print a message that says it worked.
- **Assert on the exit code and on the line that carries the claim.** An exit code of 0 alone proves the command ran, not that it did the right thing.
- **For a change to data, show before and after**: query, run, query again, and assert on the difference.
- **Prove the refusal too** when the change is a safeguard: run the case that must fail and assert that it fails.

## Details

- The command runs without a shell. Pass arguments as a list. For a pipe or a redirect, run `sh` with `["-c", "..."]`.
- `options.cwd` sets the folder and `options.env` adds variables. `options.timeoutMs` changes the one-minute limit; for a longer command also raise the flow's own limit with `flow.setTimeout(ms)`. A command still running when the flow ends is stopped, along with everything it started.
- **Which database a command reaches.** The command gets the project's `proof.terminalEnv` on top of your own environment. A project sets its proof database there, because a script that loads the app's `.env` by itself would otherwise reach the shared dev database. Check the project's `proof/playwright.config.ts` before recording a command that writes data; if `terminalEnv` is not set, pass the database through `options.env`.
- **Masking** happens before anything reaches the page or the returned output. It covers the values of variables whose names look secret (`*TOKEN*`, `*_KEY`, `*PASS*`, `*SESSION*`, `DATABASE_URL` and the like), the login part of any URL, the strings the project lists in `proof.secrets`, and every string you pass in `options.mask`. It only hides values it has been given: a secret the command reads from a file of its own is not known to it. Open the frames.
- The project's database rules still apply. A proof touches the proof database or a throwaway copy, never a shared one.
