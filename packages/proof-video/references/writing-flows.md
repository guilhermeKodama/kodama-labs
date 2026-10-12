# Writing flows

Read this when you are writing or fixing a flow. The short version is in `SKILL.md`.

## What a flow gets

A flow is a Playwright test, so `page`, `context`, `request` and `expect` work as usual. On top of those:

| Fixture | What it does | When recording |
|---|---|---|
| `scene(title, description?)` | Starts a part of the flow | Title card for about 1.6 s |
| `say(text)` | Explains the next step | Caption that stays until the next caption, scene or check, held long enough to read |
| `check(claim, assertion)` | Runs the assertion and records the result | ✓ or ✗ with the claim; the flow continues either way and fails at the end if any check failed |
| `type(locator, text)` | Clears the field and types key by key | Same keys, at reading speed |
| `typeSecret(locator, value)` | Fills a field in one go, and empties it again when the flow ends so no error report keeps the value | Action marks are off while it fills |
| `pause(ms)` | Nothing | Waits, so the viewer can take in a state |
| `terminal(command, args?, options?)` | Runs a command, returns `{ code, output }` | Shows the output on the page |

Clicks and fills get a pointer that travels to the target and a ring around it. You do not add those. Key presses and assertions leave no mark, so say in a caption which key is pressed, and make sure what a check asserts is on screen (see "Checks and what is on screen").

One file can hold several flows; each `flow(...)` is its own clip and its own test.

## Finding things on the page

1. Role and name first: `page.getByRole("button", { name: "Salvar" })`.
2. Then placeholder, label or visible text.
3. Scope before you search. "Salvar", "Excluir" and "Cancelar" exist in many places; find the dialog first and search inside it.
4. When a control needs a known sequence (a searchable list, a row in a table that only renders what is on screen), put that sequence in the app's `proof/helpers.ts` and reuse it. Read that file before writing a flow: the hard parts are usually solved there.
5. Add a `data-testid` to the app only when nothing a user can see identifies the element.

A name given as a string matches any part of the element's name and ignores case, so "Nova" also finds "Nova view". Pass `exact: true`, or a regular expression, when a shorter name is contained in a longer one.

Use the interface's own language in selectors and your own words in captions.

## Checks and what is on screen

A check that passes can still make a useless frame. `toBeVisible()` is true for an element that is rendered but scrolled out of sight, and an assertion does not scroll to its target. Before a check on something that may be below the fold or at the far end of a scrolling bar:

```ts
await row.scrollIntoViewIfNeeded();
await check("The new row is in the list", async () => {
  await expect(row).toBeInViewport();
  await expect(row).toContainText("450,00");
});
```

## Patterns

- **Dialogs and sheets.** Find them by role and title, then work inside: `const form = page.getByRole("dialog", { name: "Nova transação" })`.
- **Toasts.** They disappear after a few seconds. Assert on the toast first, then on the page, and filter by text so an older toast does not match. When the same toast text appears twice in a flow, wait for the first one to be gone (`toHaveCount(0)`) before triggering the second.
- **Reading a value to compare later.** Numbers often show a placeholder or zero before the data arrives. Wait for the value to settle (for example `expect(kpi).not.toHaveText("R$ 0")`) before reading the "before" value.
- **Long lists.** Many tables render only the rows on screen. Search or filter down to the row instead of scrolling for it.
- **Results that arrive later.** Never sleep. `await expect(locator).toHaveText(...)` retries until it is true or times out.
- **Something that leaves no trace on screen** (a setting saved in the background before a reload). Wait for the request itself: start `page.waitForResponse(...)` before the action and await it after.
- **Typing right after a dropdown closes.** A dropdown often takes focus back a moment after it closes. A test runs with no pauses, so keys typed in that moment land on the dropdown. Wait for the next field, or the dropdown's button, to have focus before typing.
- **Keyboard.** `ControlOrMeta+z` works on every platform. Shortcuts usually do nothing while a dialog is open or a field has focus.
- **Uploading a file.** `locator.setInputFiles({ name, mimeType, buffer })` on the file input; no file on disk is needed.
- **Starting signed out.** `flow.use({ storageState: { cookies: [], origins: [] } })` at the top of the file.
- **A phone-sized flow.** `flow.use({ viewport: { width: 390, height: 844 } })`. The clip is centred in the video frame.

## Pacing

What each step costs on video:

| Step | Time |
|---|---|
| `scene` | about 1.6 s |
| `say` | 0.7 s plus 45 ms per character, between 1.4 s and 5 s |
| `check` | 1.3 s when it passes, 2.6 s when it fails |
| a click or a fill | about 0.5 s |
| `type` | 40 ms per character |
| the result card that ends each flow | 1.8 s |

- Aim for a flow of about a minute: two to four scenes, two or three captions each. Split a flow that runs much past 75 seconds.
- Captions and claims share one line at the edge of the page. Keep a caption under about 65 characters and a check's claim under about 45; longer ones wrap and cover the app. Over a dialog or a sheet the line sits on its title, so keep claims made there shorter still.
- Put the caption before the action it describes. A caption between an action and its check delays the check and can outlive a toast you meant to assert on.
- Use `pause` sparingly, after a state the viewer should read (a chart, a summary).

## Leaving things as you found them

Every run starts by rebuilding the demo data, so a flow does not need to undo the rows it created. Within one run the flows share that data, so undo what would change another flow's screen: a saved view, a setting such as the theme, a filter that the app remembers.

## Debugging a flow

- Watch it run: `pnpm --filter <app> proof <file> --headed`, or step through with `--debug`.
- After a failure, `proof/out/runs/<flow>/error-context.md` has a snapshot of the page: the roles and names Playwright saw. When a step threw, it is the page at that step. When only a check failed, the flow carried on, so it is the page at the end of the flow.
- To see what a page offers, print `await page.locator("body").ariaSnapshot()` from a scratch flow, or save `await page.screenshot({ path })` and open it. A flow with no check fails, so give the scratch flow one trivial check, and delete it afterwards.
- Limits: an `expect` retries for 10 seconds, an action waits 15 seconds for its target, and a flow has 90 seconds as a test and 5 minutes when recording. A flow that needs longer says so itself: `flow.setTimeout(ms)`.
- A check that passes as a test and fails when recording is almost always a timing assumption: something asserted on a toast or a transient state that the caption outlived.
- The opposite, passing when recorded and failing as a test, is a step that relied on the recording's pauses. See "Typing right after a dropdown closes".

## What a recording writes

In `proof/out/` (never committed). Each recording replaces the previous one's files.

- `proof.mp4`, or `FAILED-proof.mp4` when anything failed;
- `frames/`: one frame per check, named by time and claim;
- `proof.md`: the text for the pull request;
- `proof.json`: commit, result, and every scene and check with its time in the video;
- `runs/`: Playwright's working files, including the error snapshots.

Two fields of `proof.json` to act on:

- `dirty: true` means files were changed or untracked when you recorded, so the video is not of the commit it names. Commit and record again before handing it over.
- `video.overLimit: true` means the video is larger than the upload limit even at the lowest quality. Record fewer flows per video.

## Several agents at once

One agent can split the writing of flows among others, as long as they do not share data or files:

1. The lead starts the app once and keeps it up: `pnpm --filter <app> proof:server`.
2. Each agent gets its own flow files to write and its own slot: `PROOF_SLOT=<name>` in front of its commands. A slot has its own demo user and its own results folder (`proof/out/slot-<name>/`), when the app's setup supports slots (the project's `proof/env.ts` says so).
3. Agents run and record only their own flows, and open their own frames. Every run rebuilds its slot's demo user, so run one command at a time per slot. Every run also applies the branch's pending migrations to the proof database; nobody resets that database or touches another slot's data.
4. The lead records the final video alone, in one run without a slot, and reviews the frames again: flows that passed alone can still disturb each other in sequence.
