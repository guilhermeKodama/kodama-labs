---
name: proof-video
description: Record a narrated video that shows a change working in the running app and proves it with real checks. The same flow files run as end-to-end tests. Use this whenever a change needs proof before a pull request or a review, when a project rule asks for a proof video, or when someone asks to "record a proof", "show it working", "make a demo or tutorial video of this flow", "run the e2e flows" or "add an end-to-end test for this screen". Also use it for changes with nothing to see in the product (scripts, migrations): it records the commands and their result. Covers setting the tool up in a project that does not have it yet.
---

# Proof video

A proof video is a short screen recording of the real app, with captions that explain what is happening and check marks that only appear when a real assertion passes. The person who reviews the change watches it instead of reproducing the change by hand, then gives feedback by timestamp.

Each video comes from **flows**: Playwright tests with a narrator. Run a flow plainly and it is a fast end-to-end test. Run it with recording on and the same steps become the video. There is one way to record, so every video in a project looks the same and every flow written for a proof stays behind as a regression test.

## What the project decides

The tool only records. Each project decides when a video is required, what it must show and where it goes. Look for a "Proof video" rule in the project's `AGENTS.md` or `CLAUDE.md` and follow it.

Find the app's `proof/` folder and its package scripts (`proof`, `proof:record`, `proof:once`). If the project has neither, set them up first: read `references/new-project.md`.

## The routine

1. **List what changed.** Read the diff against the base branch and write down each behaviour a user would notice. Those are the claims the video has to prove. A part of the diff you cannot prove goes under "Not proven" in the pull request, with the reason.

2. **Pick or write the flow.** If a flow in `proof/flows/` already walks through the screen, extend it. Otherwise add a file. For a change that cannot be replayed later (a migration, a one-off script), write it under `proof/once/` instead. See "Writing a flow" below and `references/writing-flows.md`.

3. **Run it as a test until it passes.** No video, so this loop is fast:

   ```bash
   pnpm --filter <app> proof proof/flows/<file>.flow.ts
   ```

4. **Commit, then record.** The closing card and the manifest name the commit, so record at the commit you are about to push. With uncommitted or untracked files the recording still runs, but it is marked as not matching its commit, and that shows on the video and in the pull request text:

   ```bash
   pnpm --filter <app> proof:record
   ```

   That records every flow in `flows/`. Pass file paths to record only some. A one-off proof records with `proof:once`.

5. **Open the frames before you hand the video over.** The run writes one frame per check into `proof/out/frames/`, taken from the finished video. Read every one. This step exists because a run can pass while the video shows the wrong thing. Reject the recording if a frame shows:
   - a blank page, a spinner, a sign-in page or a 404 where the product should be;
   - the thing being checked hidden, off screen or covered;
   - an error message nobody asked for;
   - a secret, or data that is not the project's demo data.

6. **Hand it over** the way the project's rule says. The run writes the text for the pull request to `proof/out/proof.md`: paste it into the body and add what only you know (what is not proven, and the results of lint, typecheck and tests). Upload the video with the GitHub CLI, which turns the `./proof.mp4` reference in that text into a player:

   ```bash
   gh pr create --title "<title>" --body-file <body.md> --attach <app>/proof/out/proof.mp4
   gh pr edit <number> --body-file <body.md> --attach <app>/proof/out/proof.mp4
   ```

   `--attach` needs a recent `gh` (2.102 has it). If the reviewer is in the conversation, send them the video file there as well.

7. **After feedback, record again.** Feedback usually comes with a time ("at 0:42 the badge is wrong"). `proof/out/proof.json` has the time of every scene and check, so find the step, fix the product or the flow, commit, record, and replace the section in the pull request. The video must always be of the last commit.

## Writing a flow

```ts
import { expect, flow } from "@repo/proof-video";

flow("Create an expense and undo it", async ({ page, scene, say, check, type }) => {
  await page.goto("/transactions");

  await scene("Create an expense", "From the keyboard, in one dialog");
  await say("N opens the new transaction form from anywhere");
  await page.keyboard.press("n");
  await type(page.getByPlaceholder("0,00"), "42,50");
  await page.getByRole("button", { name: "Salvar" }).click();

  await check("The expense shows up in the table", async () => {
    await expect(page.getByText("Café da prova")).toBeVisible();
  });
});
```

- `scene(title, description?)` shows a title card. Use one for each part of the flow.
- `say(text)` shows a caption until the next caption, scene or check. Say what is about to happen and why it matters, in words the reviewer would use.
- `check(claim, assertion)` runs a real `expect`. The claim appears with ✓ only after the assertion passes, and with ✗ when it fails.
- `type(locator, text)` clears a field and types key by key. `typeSecret(locator, value)` fills a password without showing it.
- `terminal(command, args)` runs a command and shows its output: see `references/terminal-proof.md`.

What makes a flow count as proof:

- **Every claim has a check that would fail without the change.** A flow that opens a screen and scrolls proves nothing. Ask of each check: if the change were reverted, would this turn red?
- **Check what the user sees**: text, a row, a state on screen. A check on a network call or on internal state does not show on the video.
- **Use data the flow made itself**, with names that cannot collide ("Café da prova"). Do not assert on dates, totals or counts that depend on the seed or on today.
- **Wait with `expect`**, which retries until the page settles. `pause(ms)` exists only to give the viewer time and does nothing when the flow runs as a test.
- **Keep each flow independent.** It starts from a known page and does not rely on another flow having run.

## When a check fails

The recording carries on to the end, the command exits with an error and the file is named `FAILED-proof.mp4`. That video is useful: it shows what went wrong.

Find out which side is wrong. If the product is wrong, fix it. If the flow was wrong (a selector, a wait), fix the flow and say what you changed. Never make a check pass by weakening it, deleting it or swapping in a flow that happens to pass. A red proof reported honestly is worth more than a green one that proves nothing.

The flow also fails by itself when the page throws a JavaScript error, the app answers with a 5xx, the page calls a host outside this machine, or the flow reaches its end without a single check. A flow marked as skipped fails the recording too. Those are real findings; report them.

## Safety

- Recordings write demo data and run migrations, so they use a database made for them and nothing else. The project's setup refuses any other, and commands run with `terminal()` get the proof environment the project configured. Never work around either, and before a command that writes data, know which database it will reach.
- `typeSecret` keeps a value off the video and out of error reports. `terminal` masks the secrets it knows about: variables with secret-looking names, the login part of URLs, and what the project lists. Neither is a guarantee, so you are the last check: the frames are where a leak would show.
- The app under recording runs locally. Do not point a recording at a deployed environment.

## More

- `references/writing-flows.md`: selectors, common patterns, phone-sized flows, debugging a failing flow, several agents recording at once.
- `references/terminal-proof.md`: proof for a change with nothing to see in the product.
- `references/new-project.md`: adding the tool to a project.
