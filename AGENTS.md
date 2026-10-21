# Rules for every agent in this repository

The rest of the repository's rules (local secrets, builds and migrations, the Capital data model, ports) are in `CLAUDE.md`. Read it too.

## Proof video

Every pull request carries a video, recorded by the agent that made the change, showing the change working in the running product and proving that it works. The owner reviews from the video.

1. Follow `packages/proof-video/SKILL.md`. Record with that tool and no other.
2. Show the change in the product itself. Captions explain what it does. Each behaviour the diff changes gets a `check` that would fail without the change.
3. Open the extracted frames before attaching. Report a failed run; never hide it or weaken a check to pass.
4. The pull request body has the `## Proof` section the tool generates, with the video attached.
5. After feedback, fix, record again at the new commit and replace the section.
6. Nothing visible in the product: record the commands and their result with `terminal()`.
7. Docs only: write `Proof: not applicable (docs only)`. Cannot record: open a draft pull request with `Proof: blocked: <reason>`.

When you delegate work, pass this rule on.

Apps with a proof setup so far: `apps/capital` (`pnpm --filter @wallex/capital proof`, `proof:record`, `proof:once`, `proof:package`). A change to another app starts by adding its `proof/` folder: see `packages/proof-video/references/new-project.md`.

## Validation package

At the end of every piece of work the owner asks for, after its pull requests, hand over a **validation-package** (the owner's term): a video and full-resolution screenshots of the screens the work changed, in light and dark (and at phone size when the work is about the phone). Cover only the affected areas. The full tour of every screen, from the app's `proof/package/` suite (`pnpm --filter <app> proof:package`), is for work that changes every screen (theme, shell, fonts) or when the owner asks for it. See "Validation package" in `packages/proof-video/SKILL.md`, whose current definition is the one to follow. A screen the work adds joins the tour in the same work. Send the video and the screenshots to the owner in the conversation.
