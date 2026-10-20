import path from "node:path";
import { expect, flow } from "@repo/proof-video";

const repo = path.resolve(__dirname, "../../../..");

// Proof for the change that added the recorder: nothing in the product
// shows that it refuses every database except a proof one.
flow("The recorder only ever writes to a proof database", async ({ scene, say, check, terminal }) => {
  await scene("Database guard", "Nothing to see in the product, so the proof is the commands and their result");

  await say("The recorder's unit tests: database name, checkout port, secret masking");
  const tests = await terminal("pnpm", ["--filter", "@repo/proof-video", "test"], { cwd: repo });
  await check("The unit tests pass", async () => {
    expect(tests.code).toBe(0);
    expect(tests.output).toMatch(/Tests\s+\d+ passed/);
  });

  await say("Now the guard itself, asked to use Capital's shared dev database");
  const refused = await terminal(
    "pnpm",
    [
      "--filter",
      "@wallex/capital",
      "exec",
      "tsx",
      "-e",
      'require("@repo/proof-video/environment").assertProofDatabase("postgresql://user:password@localhost:5433/capital_dev", "capital")',
    ],
    { cwd: repo },
  );
  await check("It refuses capital_dev and exits with an error", async () => {
    expect(refused.code).not.toBe(0);
    expect(refused.output).toContain('Refusing the database "capital_dev"');
  });
});
