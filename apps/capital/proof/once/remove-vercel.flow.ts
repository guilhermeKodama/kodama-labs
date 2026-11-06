import path from "node:path";
import { expect, flow } from "@repo/proof-video";

const repo = path.resolve(__dirname, "../../../..");

// Nothing in the product shows that Vercel is gone. The proof is the
// search of the tree and the storage tests that refuse a remote fetch.
flow("Vercel is gone and blobs stay on this machine", async ({ scene, say, check, terminal }) => {
  await scene(
    "No Vercel in the toolchain",
    "Nothing to see in the product, so the proof is the search and the storage tests",
  );

  await say("Search for Vercel projects, packages, blob hosts, and the old blob token");
  const search = await terminal(
    "sh",
    [
      "-c",
      [
        "pattern='vercel\\.json|@vercel/|blob\\.vercel-storage|BLOB_READ_WRITE_TOKEN|\\.vercel|hono/vercel'",
        "rg -n -i \"$pattern\" --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!**/pnpm-lock.yaml' --glob '!**/.next/**' --glob '!**/proof/out/**' --glob '!apps/capital/proof/once/remove-vercel.flow.ts'",
        "status=$?",
        "if [ \"$status\" -eq 0 ]; then echo 'vercel toolchain matches remain'; exit 1; fi",
        "if [ \"$status\" -eq 1 ]; then echo 'no vercel toolchain matches'; exit 0; fi",
        "exit \"$status\"",
      ].join("\n"),
    ],
    { cwd: repo },
  );
  await check("The toolchain search finds nothing", async () => {
    expect(search.code).toBe(0);
    expect(search.output).toContain("no vercel toolchain matches");
    expect(search.output).not.toContain("vercel toolchain matches remain");
  });

  await say("Storage tests: a URL that is not on local disk is not fetched");
  const tests = await terminal(
    "pnpm",
    ["--filter", "@repo/storage", "exec", "vitest", "run", "--reporter=verbose"],
    { cwd: repo },
  );
  await check("Local blob tests pass and refuse the remote fetch", async () => {
    expect(tests.code).toBe(0);
    expect(tests.output).toContain("does not fetch a url that is not a local blob");
    expect(tests.output).toMatch(/Tests\s+6 passed/);
  });
});
