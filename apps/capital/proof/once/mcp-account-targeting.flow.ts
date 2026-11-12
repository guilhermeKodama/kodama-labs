import path from "node:path";
import { expect, flow } from "@repo/proof-video";

const repo = path.resolve(__dirname, "../../../..");

// The app logs every SQL statement in development. On a recording each
// line is drawn onto the page, so the passing test names scroll away and
// the video blows past the upload limit. test keeps the errors and the
// vitest lines.
const quiet = { cwd: repo, env: { NODE_ENV: "test" } };

// Three vitest runs, each starting its own worker. The default 90s test
// limit is tight once pnpm has to boot them.
flow.setTimeout(360_000);

// The tools are the product here: nothing on a screen changed. The proof is
// the tests that book, move, refuse, create, and archive accounts.
flow("MCP tools can target one bank account of a PJ", async ({ scene, say, check, terminal }) => {
  await scene("Bank accounts", "Inter PJ and Nu Empresas under one business, from the MCP tools");

  await say("Creating a row on a chosen account, refusing a bad one, and deduping per account");
  const created = await terminal(
    "pnpm",
    ["--filter", "@wallex/capital", "exec", "vitest", "run", "src/server/modules/mcp/tools/__tests__/bulk-create-transactions.test.ts", "--reporter=verbose"],
    { ...quiet, timeoutMs: 120_000 },
  );
  await check("A PJ expense lands on Inter PJ, and a row with no account stays on the main account", async () => {
    expect(created.code).toBe(0);
    expect(created.output).toContain("books a row on the given account and leaves the main account alone");
  });
  await check("A missing, archived, or other-entity account is an error on that item only", async () => {
    expect(created.code).toBe(0);
    expect(created.output).toContain("rejects a missing, archived, or other-entity account on that item only");
  });

  await say("Moving a transaction updates both account balances, and an investment leg is refused");
  const moved = await terminal(
    "pnpm",
    ["--filter", "@wallex/capital", "exec", "vitest", "run", "src/server/modules/mcp/tools/__tests__/bulk-update-transactions.test.ts", "--reporter=verbose"],
    { ...quiet, timeoutMs: 180_000 },
  );
  await check("Moving an expense from Inter PJ to Nu Empresas moves the balance and undo puts it back", async () => {
    expect(moved.code).toBe(0);
    expect(moved.output).toContain("moves a transaction to another account of the same entity and the balances follow");
  });
  await check("A cash leg tied to a position is refused, and a plain investment row can still move", async () => {
    expect(moved.code).toBe(0);
    expect(moved.output).toContain("refuses another entity, an archived account, a different currency, and an investment leg");
  });

  await say("Creating an account stores the opening balance, and archiving hides it");
  const accounts = await terminal(
    "pnpm",
    ["--filter", "@wallex/capital", "exec", "vitest", "run", "src/server/modules/mcp/tools/__tests__/ledger-accounts.test.ts", "--reporter=verbose"],
    { ...quiet, timeoutMs: 120_000 },
  );
  await check("The opening balance is the account's initial balance, with no ledger entry and no stored date", async () => {
    expect(accounts.code).toBe(0);
    expect(accounts.output).toContain("stores the opening balance on the account and does not write a ledger entry");
  });
  await check("A non-zero balance is refused, and an archived account is hidden and rejected for new transactions", async () => {
    expect(accounts.code).toBe(0);
    expect(accounts.output).toContain("hides an archived account, refuses a non-zero balance, and rejects new transactions");
  });
});
