import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { executeTool, type ToolContext } from "../registry";
import { proposeImportPlan } from "../write/propose-import-plan";
import { updateImportPlan } from "../write/update-import-plan";
import { commitPlan } from "../write/commit-plan";
import { proposeRevertPlan } from "../write/propose-revert-plan";

/**
 * The audit row executeTool writes for a write tool must carry the plan the
 * call was about. Two readers depend on it: commit_plan replays the stored
 * result of a plan that was already committed, and propose_revert_plan finds
 * what an agent import created. The other plan tests build the audit row by
 * hand, so they cannot see that the real path never recorded it; every call
 * here goes through executeTool.
 */

const USER = "test-user-assistant-tools-planaudit";
const OTHER = "test-user-assistant-tools-planaudit-other";

let f: LedgerFixture;
let ctx: ToolContext;
let fileId: string;
let otherConversationId: string;

const row = (fitId: string, date: string, description: string, amount: number, type: "income" | "expense") => ({ fitId, date, description, fullDescription: description, amount, type });

const payload = () => ({
  entityType: "personal",
  entityId: f.pfId,
  fileId,
  currency: "BRL",
  bankName: "Nubank",
  transactions: [
    { externalId: "AUD-A", date: "2026-09-02", description: "Mercado", amount: 80, type: "expense", category: "Groceries" },
    { externalId: "AUD-B", date: "2026-09-05", description: "Salario", amount: 3000, type: "income", category: "Salary" },
  ],
});

const call = (name: string, tool: typeof proposeImportPlan | typeof updateImportPlan | typeof commitPlan | typeof proposeRevertPlan, input: unknown) =>
  executeTool([tool], ctx, `tool-${name}`, tool.name, input);

const audit = (toolName: string) => prisma.agentAction.findMany({ where: { conversationId: ctx.conversationId, toolName }, orderBy: { createdAt: "asc" } });

/** What the confirm endpoint does when the user clicks the button; only the test plays that part. */
const confirm = (planId: string) => prisma.importPlan.update({ where: { id: planId }, data: { status: "confirmed", confirmedAt: new Date(), confirmedVia: "ui_button" } });

beforeAll(async () => {
  await prisma.import.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "plan audit" } });
  const turn = await prisma.agentTurn.create({ data: { conversationId: conversation.id, model: "claude-test" } });
  ctx = { userId: USER, conversationId: conversation.id, turnId: turn.id, db: prisma };
  otherConversationId = (await prisma.agentConversation.create({ data: { userId: OTHER, title: "alheia" } })).id;
  fileId = (
    await prisma.conversationFile.create({
      data: {
        conversationId: conversation.id,
        userId: USER,
        fileType: "ofx",
        statementKind: "bank_ofx",
        blobUrl: "blob://auditoria.ofx",
        pathname: "auditoria.ofx",
        mimeType: "application/x-ofx",
        sizeBytes: 100,
        originalName: "auditoria.ofx",
        parseStatus: "parsed",
        parsedPayload: {
          kind: "bank_ofx",
          bankName: "Nubank",
          accountId: "1",
          currency: "BRL",
          ledgerBalance: 0,
          balanceDate: "2026-09-30",
          dateStart: "2026-09-01",
          dateEnd: "2026-09-30",
          rows: [row("AUD-A", "2026-09-02", "Mercado", 80, "expense"), row("AUD-B", "2026-09-05", "Salario", 3000, "income")],
        },
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.import.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

beforeEach(async () => {
  await prisma.importPlan.deleteMany({ where: { conversationId: { in: [ctx.conversationId, otherConversationId] } } });
  await prisma.agentAction.deleteMany({ where: { conversationId: ctx.conversationId } });
  // A plan that was committed in an earlier test left its rows behind, and the
  // next proposal of the same statement rows would be refused as already imported.
  await prisma.import.deleteMany({ where: { userId: USER } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: USER, externalId: { in: ["AUD-A", "AUD-B"] } } });
});

describe("the audit row of the plan tools", () => {
  it("names the plan a call produced or amended", async () => {
    const proposed = await call("propose", proposeImportPlan, payload());
    expect(proposed.isError).toBe(false);
    const planId = (proposed.output as { planId: string }).planId;
    expect((await audit("propose_import_plan")).map((a) => a.planId)).toEqual([planId]);

    const amended = await call("update", updateImportPlan, { planId, payload: { ...payload(), bankName: "Nubank PJ" } });
    expect(amended.isError).toBe(false);
    expect((await audit("update_import_plan")).map((a) => a.planId)).toEqual([planId]);
  });

  it("names the plan on a call that failed, so the audit shows which plan it was pointed at", async () => {
    const proposed = await call("propose", proposeImportPlan, payload());
    const planId = (proposed.output as { planId: string }).planId;

    // Still "proposed": commit_plan refuses it, and the failed attempt belongs to that plan.
    const refused = await call("early-commit", commitPlan, { planId });
    expect(refused.isError).toBe(true);
    expect((await audit("commit_plan")).map((a) => [a.status, a.planId])).toEqual([["error", planId]]);
  });

  it("never records an id that is not a plan of this user, and never lets that break the audit", async () => {
    const theirs = await prisma.importPlan.create({
      data: { userId: OTHER, conversationId: otherConversationId, kind: "import", status: "confirmed", confirmedAt: new Date(), payload: {}, payloadHash: "x", summary: {}, warnings: [] },
    });

    for (const planId of ["a-plan-the-model-made-up", theirs.id]) {
      const result = await call("bad-plan", commitPlan, { planId });
      expect(result).toMatchObject({ isError: true, output: { error: "Plan not found or access denied" } });
    }
    expect((await audit("commit_plan")).map((a) => [a.status, a.planId])).toEqual([
      ["error", null],
      ["error", null],
    ]);
  });
});

describe("commit_plan through executeTool", () => {
  it("writes the plan once and replays the stored result when the model commits it again", async () => {
    const planId = ((await call("propose", proposeImportPlan, payload())).output as { planId: string }).planId;
    await confirm(planId);

    const first = await call("commit-1", commitPlan, { planId });
    expect(first.isError).toBe(false);
    expect(first.output).toMatchObject({ imported: 2, planId });
    expect((await audit("commit_plan")).map((a) => [a.status, a.planId])).toEqual([["success", planId]]);
    const entriesAfterFirst = await prisma.ledgerEntry.count({ where: { userId: USER, externalId: { in: ["AUD-A", "AUD-B"] } } });
    expect(entriesAfterFirst).toBe(2);

    // Same plan, second call: the result is replayed, nothing is written again.
    const second = await call("commit-2", commitPlan, { planId });
    expect(second.isError).toBe(false);
    expect(second.output).toMatchObject({ imported: 2, planId, replayed: true });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, externalId: { in: ["AUD-A", "AUD-B"] } } })).toBe(entriesAfterFirst);
    expect(await prisma.import.count({ where: { importPlanId: planId } })).toBe(1);
    // The replay is audited too, against the same plan.
    expect((await audit("commit_plan")).map((a) => [a.status, a.planId])).toEqual([
      ["success", planId],
      ["success", planId],
    ]);
  });
});

describe("propose_revert_plan through executeTool", () => {
  it("finds what an agent import created by reading its commit_plan audit row", async () => {
    const planId = ((await call("propose", proposeImportPlan, payload())).output as { planId: string }).planId;
    await confirm(planId);
    expect((await call("commit", commitPlan, { planId })).isError).toBe(false);
    const imported = await prisma.import.findUniqueOrThrow({ where: { importPlanId: planId } });
    expect(imported.source).toBe("agent");

    const revert = await call("revert", proposeRevertPlan, { statementImportId: imported.id });
    expect(revert.isError).toBe(false);
    const output = revert.output as { planId: string; warnings: string[]; summary: { recordsToDelete: number; byModel: Record<string, number> } };

    // The two entries are found through the ledger; the Import itself only through the audit row.
    expect(output.summary.byModel).toMatchObject({ LedgerEntry: 2, Import: 1 });
    expect(output.warnings).not.toContain("No tracked records were found to revert.");
    const plan = await prisma.importPlan.findUniqueOrThrow({ where: { id: output.planId } });
    const records = (plan.payload as { createdRecords: { model: string; id: string }[] }).createdRecords;
    expect(records).toContainEqual({ model: "Import", id: imported.id });
    // The revert proposal is itself audited against its own plan.
    expect((await audit("propose_revert_plan")).map((a) => a.planId)).toEqual([output.planId]);
  });
});
