import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { PLAN_CONFIRMATION_WINDOW_MS } from "../../../constants";
import { executeTool, type AnyAgentToolDef, type ToolContext } from "../registry";
import { ImportPlanPayloadSchema, computePlanSummary, hashJson, hashPlanPayload } from "../schemas/import-plan-payload";
import { proposeImportPlan } from "../write/propose-import-plan";
import { updateImportPlan } from "../write/update-import-plan";
import { commitPlan } from "../write/commit-plan";
import { proposeRevertPlan } from "../write/propose-revert-plan";
import { presentCard } from "../ui/present-card";

const USER = "test-user-assistant-tools-plans";
const OTHER = "test-user-assistant-tools-plans-other";

let f: LedgerFixture;
let other: LedgerFixture;
let ctx: ToolContext;
let fileId: string;

const run = (tool: AnyAgentToolDef, input: unknown) => tool.handler(ctx, tool.inputSchema.parse(input));
const out = <T>(value: unknown) => value as T;

const ofxRow = (fitId: string, date: string, description: string, amount: number, type: "income" | "expense") => ({ fitId, date, description, fullDescription: description, amount, type });

beforeAll(async () => {
  await prisma.import.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "plan tools" } });
  const turn = await prisma.agentTurn.create({ data: { conversationId: conversation.id, model: "claude-test" } });
  ctx = { userId: USER, conversationId: conversation.id, turnId: turn.id, db: prisma };
  fileId = (
    await prisma.conversationFile.create({
      data: {
        conversationId: conversation.id,
        userId: USER,
        fileType: "ofx",
        statementKind: "bank_ofx",
        blobUrl: "blob://setembro.ofx",
        pathname: "setembro.ofx",
        mimeType: "application/x-ofx",
        sizeBytes: 100,
        originalName: "setembro.ofx",
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
          rows: [ofxRow("FIT-A", "2026-09-02", "Mercado", 80, "expense"), ofxRow("FIT-B", "2026-09-05", "Salario", 3000, "income"), ofxRow("FIT-C", "2026-09-07", "Cafe", 12.5, "expense")],
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
  // Every test starts from a conversation without plans.
  await prisma.importPlan.deleteMany({ where: { conversationId: ctx.conversationId } });
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  entityType: "personal",
  entityId: f.pfId,
  fileId,
  currency: "BRL",
  bankName: "Nubank",
  transactions: [{ externalId: "FIT-A", date: "2026-09-02", description: "Mercado", amount: 80, type: "expense", category: "Groceries" }],
  ...overrides,
});

describe("propose_import_plan", () => {
  it("saves the validated plan as PROPOSED with its summary and hash, writing no domain data", async () => {
    const entriesBefore = await prisma.ledgerEntry.count({ where: { userId: USER } });
    const input = payload({
      transactions: [
        { externalId: "FIT-A", date: "2026-09-02", description: "Mercado", amount: 80, type: "expense" },
        { externalId: "FIT-B", date: "2026-09-05", description: "Salario", amount: 3000, type: "income" },
      ],
    });
    const result = out<{ planId: string; summary: Record<string, unknown>; payloadHash: string }>(await run(proposeImportPlan, input));

    const parsed = ImportPlanPayloadSchema.parse(input);
    expect(result).toMatchObject({ kind: "import", status: "proposed", warnings: [], payloadHash: hashPlanPayload(parsed) });
    expect(result.summary).toEqual(computePlanSummary(parsed));
    expect(result.summary).toMatchObject({ newTransactionCount: 2, totalIncome: 3000, totalExpense: 80, currency: "BRL" });

    const plan = await prisma.importPlan.findUniqueOrThrow({ where: { id: result.planId } });
    expect(plan).toMatchObject({ conversationId: ctx.conversationId, userId: USER, kind: "import", status: "proposed", entityType: "personal", entityId: f.pfId, fileId, payloadHash: result.payloadHash, warnings: [], confirmedAt: null });
    expect(plan.payload).toEqual(JSON.parse(JSON.stringify(parsed)));
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entriesBefore);
  });

  it("supersedes the previous proposal of the conversation", async () => {
    const first = out<{ planId: string }>(await run(proposeImportPlan, payload()));
    const second = out<{ planId: string }>(await run(proposeImportPlan, payload({ transactions: [{ externalId: "FIT-C", date: "2026-09-07", description: "Cafe", amount: 12.5, type: "expense" }] })));
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: first.planId } })).status).toBe("superseded");
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: second.planId } })).status).toBe("proposed");
  });

  it("warns, without refusing, about rows it cannot check and about plans that write nothing", async () => {
    const unverifiable = out<{ warnings: string[] }>(await run(proposeImportPlan, payload({ transactions: [{ externalId: "NOT-IN-FILE", date: "2026-09-09", description: "Fantasma", amount: 9, type: "expense" }] })));
    expect(unverifiable.warnings).toEqual(["1 row(s) could not be checked against the file's parsed rows (NOT-IN-FILE) - their amount and direction are taken on trust."]);

    const empty = out<{ warnings: string[]; summary: { newTransactionCount: number } }>(await run(proposeImportPlan, payload({ transactions: [] })));
    expect(empty.summary.newTransactionCount).toBe(0);
    expect(empty.warnings).toEqual(["This plan has nothing to write - every row was a plain skip."]);
  });

  it("refuses a plan that contradicts the file, the ledger or the user's ownership, saving nothing", async () => {
    const stale = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 12.5, date: "2026-09-07", description: "Cafe", externalId: "FIT-C" }, prisma);
    expect(stale.entryIds).toHaveLength(1);

    const attempts: [Record<string, unknown>, string][] = [
      [{ transactions: [{ externalId: "FIT-A", date: "2026-09-02", description: "Mercado", amount: 80, type: "income" }] }, 'Transaction FIT-A is typed "income" but the statement row is an expense'],
      [{ transactions: [{ externalId: "FIT-A", date: "2026-09-02", description: "Mercado", amount: 81, type: "expense" }] }, "Transaction FIT-A has amount 81 but the statement row is 80"],
      [{ transactions: [{ externalId: "FIT-C", date: "2026-09-07", description: "Cafe", amount: 12.5, type: "expense" }] }, "already exist for this entity - the plan is stale"],
      [{ entityId: other.pfId }, `personal entity ${other.pfId} not found or access denied`],
      [{ fileId: undefined }, "fileId is required when the assistant proposes an import plan"],
      [{ fileId: "missing-file" }, "File missing-file not found or access denied"],
    ];
    for (const [overrides, message] of attempts) {
      await expect(run(proposeImportPlan, payload(overrides))).rejects.toThrow(message);
    }
    expect(await prisma.importPlan.count({ where: { conversationId: ctx.conversationId } })).toBe(0);
  });

  it("rejects an input that is not a plan before it reaches the handler", async () => {
    const result = await executeTool([proposeImportPlan], ctx, "tool-1", "propose_import_plan", { entityType: "personal" });
    expect(result.isError).toBe(true);
    expect(result.output).toMatchObject({ error: expect.stringContaining("Invalid input for propose_import_plan") });
  });

  it("is audited as a plan-writing tool when run through the executor", async () => {
    const result = await executeTool([proposeImportPlan], ctx, "tool-2", "propose_import_plan", payload());
    expect(result.isError).toBe(false);
    const audit = await prisma.agentAction.findFirstOrThrow({ where: { conversationId: ctx.conversationId, toolName: "propose_import_plan", status: "success" } });
    expect(audit).toMatchObject({ userId: USER, turnId: ctx.turnId, createdRecords: null, output: { kind: "import", status: "proposed" } });
    await prisma.agentAction.deleteMany({ where: { conversationId: ctx.conversationId } });
  });
});

describe("update_import_plan", () => {
  it("replaces the payload, summary, hash and warnings of a proposed plan", async () => {
    const proposed = out<{ planId: string; payloadHash: string }>(await run(proposeImportPlan, payload()));
    const amended = payload({ transactions: [{ externalId: "FIT-B", date: "2026-09-05", description: "Salario", amount: 3000, type: "income" }, { externalId: "GHOST", date: "2026-09-06", description: "Sem arquivo", amount: 5, type: "expense" }] });

    const result = out<{ planId: string; payloadHash: string; summary: Record<string, unknown>; warnings: string[] }>(await run(updateImportPlan, { planId: proposed.planId, payload: amended }));
    const parsed = ImportPlanPayloadSchema.parse(amended);
    expect(result).toMatchObject({ planId: proposed.planId, kind: "import", status: "proposed", payloadHash: hashPlanPayload(parsed) });
    expect(result.payloadHash).not.toBe(proposed.payloadHash);
    expect(result.summary).toMatchObject({ newTransactionCount: 2, totalIncome: 3000, totalExpense: 5 });
    expect(result.warnings).toHaveLength(1);

    const plan = await prisma.importPlan.findUniqueOrThrow({ where: { id: proposed.planId } });
    expect(plan).toMatchObject({ status: "proposed", payloadHash: result.payloadHash, summary: JSON.parse(JSON.stringify(result.summary)), warnings: result.warnings });
    expect(plan.payload).toEqual(JSON.parse(JSON.stringify(parsed)));
  });

  it("refuses an amendment that fails validation, leaving the plan as it was", async () => {
    const proposed = out<{ planId: string; payloadHash: string }>(await run(proposeImportPlan, payload()));
    await expect(run(updateImportPlan, { planId: proposed.planId, payload: payload({ transactions: [{ externalId: "FIT-A", date: "2026-09-02", description: "Mercado", amount: 80, type: "income" }] }) })).rejects.toThrow("is typed \"income\" but the statement row is an expense");
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: proposed.planId } })).payloadHash).toBe(proposed.payloadHash);
  });

  it.each(["confirmed", "committed", "rejected", "superseded"] as const)("will not amend a %s plan", async (status) => {
    const proposed = out<{ planId: string; payloadHash: string }>(await run(proposeImportPlan, payload()));
    await prisma.importPlan.update({ where: { id: proposed.planId }, data: { status } });
    await expect(run(updateImportPlan, { planId: proposed.planId, payload: payload({ currency: "USD" }) })).rejects.toThrow(`Plan is "${status}" - only a "proposed" plan can be amended`);
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: proposed.planId } })).payloadHash).toBe(proposed.payloadHash);
  });

  it("does not know plans of other users or missing ones", async () => {
    const theirs = await prisma.importPlan.create({ data: { conversationId: (await prisma.agentConversation.create({ data: { userId: OTHER, title: "alheia" } })).id, userId: OTHER, payload: {}, payloadHash: "h", summary: {} } });
    await expect(run(updateImportPlan, { planId: theirs.id, payload: payload() })).rejects.toThrow("Plan not found or access denied");
    await expect(run(updateImportPlan, { planId: "missing-plan", payload: payload() })).rejects.toThrow("Plan not found or access denied");
  });
});

describe("commit_plan", () => {
  const plan = (data: { status?: "proposed" | "confirmed" | "committed" | "rejected" | "superseded"; kind?: "import" | "revert"; confirmedAt?: Date | null; payload?: unknown; userId?: string; conversationId?: string }) =>
    prisma.importPlan.create({
      data: {
        conversationId: data.conversationId ?? ctx.conversationId,
        userId: data.userId ?? USER,
        kind: data.kind ?? "import",
        status: data.status ?? "confirmed",
        confirmedAt: data.confirmedAt === undefined ? new Date() : data.confirmedAt,
        payload: (data.payload ?? {}) as object,
        payloadHash: "hash",
        summary: {},
      },
    });

  it("writes a proposed-then-confirmed plan to the ledger, marks it committed and links the import to it", async () => {
    const proposed = out<{ planId: string }>(await run(proposeImportPlan, payload({ transactions: [{ externalId: "FIT-A", date: "2026-09-02", description: "Mercado", amount: 80, type: "expense", category: "Groceries" }, { externalId: "FIT-B", date: "2026-09-05", description: "Salario", amount: 3000, type: "income", category: "Salary" }] })));
    // Only the confirm endpoint may do this; the test plays its part.
    await prisma.importPlan.update({ where: { id: proposed.planId }, data: { status: "confirmed", confirmedAt: new Date(), confirmedVia: "ui_button" } });

    const result = await executeTool([commitPlan], ctx, "tool-commit", "commit_plan", { planId: proposed.planId });
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({ imported: 2, planId: proposed.planId });

    const committed = await prisma.importPlan.findUniqueOrThrow({ where: { id: proposed.planId } });
    expect(committed.status).toBe("committed");
    expect(committed.committedAt).toBeInstanceOf(Date);

    const imported = await prisma.import.findUniqueOrThrow({ where: { importPlanId: proposed.planId } });
    expect(imported).toMatchObject({ userId: USER, source: "agent", conversationId: ctx.conversationId, entityId: f.pfId, transactionCount: 2, revertedAt: null });
    const entries = await prisma.ledgerEntry.findMany({ where: { importId: imported.id }, include: { category: true }, orderBy: { date: "asc" } });
    expect(entries.map((e) => [e.externalId, e.kind, Number(e.amount), e.category?.name])).toEqual([
      ["FIT-A", "expense", -80, "Groceries"],
      ["FIT-B", "income", 3000, "Salary"],
    ]);

    const audit = await prisma.agentAction.findFirstOrThrow({ where: { conversationId: ctx.conversationId, toolName: "commit_plan", status: "success" } });
    expect(audit.turnId).toBe(ctx.turnId);
    expect((audit.createdRecords as { model: string; id: string }[]).map((r) => r.model)).toContain("LedgerEntry");
    await prisma.agentAction.deleteMany({ where: { conversationId: ctx.conversationId } });
  });

  it("will not run a plan that is missing, someone else's, or not confirmed", async () => {
    await expect(run(commitPlan, { planId: "missing-plan" })).rejects.toThrow("Plan not found or access denied");
    const theirConversation = await prisma.agentConversation.create({ data: { userId: OTHER, title: "alheia" } });
    const theirs = await plan({ userId: OTHER, conversationId: theirConversation.id });
    await expect(run(commitPlan, { planId: theirs.id })).rejects.toThrow("Plan not found or access denied");

    for (const status of ["proposed", "rejected", "superseded"] as const) {
      const p = await plan({ status, confirmedAt: null });
      await expect(run(commitPlan, { planId: p.id })).rejects.toThrow(`Plan is "${status}" - commit_plan requires status "confirmed"`);
      expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(status);
    }
  });

  it("refuses a confirmation older than the window and leaves the plan confirmed", async () => {
    const stale = await plan({ confirmedAt: new Date(Date.now() - PLAN_CONFIRMATION_WINDOW_MS - 60_000) });
    await expect(run(commitPlan, { planId: stale.id })).rejects.toThrow("The confirmation has expired - ask the user to confirm the plan again");
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("confirmed");
    expect(await prisma.import.count({ where: { importPlanId: stale.id } })).toBe(0);
  });

  it("fails on a stored payload that is no longer a valid plan, without committing it", async () => {
    const broken = await plan({ payload: { entityType: "personal" } });
    await expect(run(commitPlan, { planId: broken.id })).rejects.toThrow();
    const after = await prisma.importPlan.findUniqueOrThrow({ where: { id: broken.id } });
    expect(after).toMatchObject({ status: "confirmed", committedAt: null });
  });

  it("replays the result of a plan that was already committed instead of writing twice", async () => {
    const done = await plan({ status: "committed" });
    await expect(run(commitPlan, { planId: done.id })).rejects.toThrow("Plan is already committed but no prior result was found to replay");

    await prisma.agentAction.create({ data: { userId: USER, conversationId: ctx.conversationId, planId: done.id, toolName: "commit_plan", input: {}, output: { imported: 7, statementImportId: "imp-1" }, status: "success", durationMs: 1 } });
    // An earlier failure of the same plan is not a result to replay.
    await prisma.agentAction.create({ data: { userId: USER, conversationId: ctx.conversationId, planId: done.id, toolName: "commit_plan", input: {}, status: "error", error: "boom", durationMs: 1 } });
    expect(await run(commitPlan, { planId: done.id })).toEqual({ imported: 7, statementImportId: "imp-1", planId: done.id, replayed: true });
    expect(await prisma.import.count({ where: { importPlanId: done.id } })).toBe(0);
  });

  it("reverts a manual import: sends its entries to the trash and marks the import reverted", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Banco antigo", transactionCount: 2 } });
    const a = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-02-01", description: "A" }, prisma, { importId: imp.id })).entryIds[0];
    const b = (await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 20, date: "2026-02-02", description: "B" }, prisma, { importId: imp.id })).entryIds[0];

    const proposal = out<{ planId: string; warnings: string[]; summary: { recordsToDelete: number } }>(await run(proposeRevertPlan, { statementImportId: imp.id }));
    expect(proposal.summary.recordsToDelete).toBe(2);
    await prisma.importPlan.update({ where: { id: proposal.planId }, data: { status: "confirmed", confirmedAt: new Date() } });

    const result = out<{ transactionsDeleted: number; createdRecords: unknown[]; planId: string }>(await run(commitPlan, { planId: proposal.planId }));
    expect(result).toMatchObject({ transactionsDeleted: 2, createdRecords: [], planId: proposal.planId });
    const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: [a, b] } } });
    expect(rows.every((r) => r.deletedAt !== null)).toBe(true);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: imp.id } })).revertedAt).not.toBeNull();
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: proposal.planId } })).status).toBe("committed");
  });
});

describe("propose_revert_plan", () => {
  it("lists what a manual import wrote, warning that its cards are not tracked", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Itau", transactionCount: 3 } });
    const kept = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-02-01", description: "Mantida" }, prisma, { importId: imp.id })).entryIds[0];
    const trashed = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 11, date: "2026-02-02", description: "Lixo" }, prisma, { importId: imp.id })).entryIds[0];
    await prisma.ledgerEntry.update({ where: { id: trashed }, data: { deletedAt: new Date() } });
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 30, date: "2026-02-03", description: "Aporte" }, prisma, { importId: imp.id });

    const result = out<{ planId: string; kind: string; status: string; payloadHash: string; warnings: string[]; summary: Record<string, unknown> }>(await run(proposeRevertPlan, { statementImportId: imp.id, reason: "arquivo errado" }));
    const records = [
      { model: "LedgerEntry", id: kept },
      { model: "TransferGroup", id: transfer.transferGroupId },
    ];
    expect(result).toMatchObject({ kind: "revert", status: "proposed", warnings: ["This was a manual import - credit cards created alongside it are not tracked and will stay."] });
    expect(result.summary).toEqual({ statementImportId: imp.id, bankName: "Itau", recordsToDelete: 2, byModel: { LedgerEntry: 1, TransferGroup: 1 }, reason: "arquivo errado" });

    const plan = await prisma.importPlan.findUniqueOrThrow({ where: { id: result.planId } });
    expect(plan).toMatchObject({ userId: USER, kind: "revert", status: "proposed", entityId: null, payloadHash: result.payloadHash });
    expect(plan.payload).toEqual({ statementImportId: imp.id, createdRecords: records });
    expect(result.payloadHash).toBe(hashJson({ statementImportId: imp.id, createdRecords: records }));
  });

  it("adds the records an agent import created beyond entries and transfers, from its audit trail", async () => {
    const importPlan = await prisma.importPlan.create({ data: { conversationId: ctx.conversationId, userId: USER, status: "committed", payload: {}, payloadHash: "h", summary: {} } });
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Inter", transactionCount: 1, source: "agent", conversationId: ctx.conversationId, importPlanId: importPlan.id } });
    const entry = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-02-01", description: "Do agente" }, prisma, { importId: imp.id })).entryIds[0];
    const audit = (createdRecords: unknown, extra: { toolName?: string; planId?: string } = {}) =>
      prisma.agentAction.create({ data: { userId: USER, conversationId: ctx.conversationId, planId: extra.planId ?? importPlan.id, toolName: extra.toolName ?? "commit_plan", input: {}, status: "success", createdRecords: createdRecords as object, durationMs: 1 } });
    await audit([{ model: "Account", id: "card-1" }, { model: "LedgerEntry", id: "already-counted" }, { model: "CardStatement", id: "stmt-1" }]);
    await audit(null);
    await audit([{ model: "Account", id: "other-tool" }], { toolName: "manage_credit_card" });
    await audit([{ model: "Account", id: "other-plan" }], { planId: (await prisma.importPlan.create({ data: { conversationId: ctx.conversationId, userId: USER, payload: {}, payloadHash: "h", summary: {} } })).id });

    const result = out<{ planId: string; warnings: string[]; summary: { byModel: Record<string, number> } }>(await run(proposeRevertPlan, { statementImportId: imp.id }));
    expect(result.warnings).toEqual([]);
    expect(result.summary.byModel).toEqual({ LedgerEntry: 1, Account: 1, CardStatement: 1 });
    const stored = await prisma.importPlan.findUniqueOrThrow({ where: { id: result.planId } });
    expect(stored.payload).toEqual({
      statementImportId: imp.id,
      createdRecords: [
        { model: "LedgerEntry", id: entry },
        { model: "Account", id: "card-1" },
        { model: "CardStatement", id: "stmt-1" },
      ],
    });
  });

  it("warns when there is nothing to revert, and does not trust an agent import without a plan", async () => {
    const empty = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Vazio", transactionCount: 0 } });
    const manual = out<{ warnings: string[]; summary: { recordsToDelete: number; reason?: string } }>(await run(proposeRevertPlan, { statementImportId: empty.id }));
    expect(manual.summary).toMatchObject({ recordsToDelete: 0, bankName: "Vazio", byModel: {} });
    expect(manual.summary.reason).toBeUndefined();
    expect(manual.warnings).toEqual(["This was a manual import - credit cards created alongside it are not tracked and will stay.", "No tracked records were found to revert."]);

    const noPlan = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Agente sem plano", transactionCount: 0, source: "agent", conversationId: ctx.conversationId } });
    const agent = out<{ warnings: string[] }>(await run(proposeRevertPlan, { statementImportId: noPlan.id }));
    expect(agent.warnings).toEqual(["No tracked records were found to revert."]);
  });

  it("supersedes an open proposal and refuses imports that are missing, someone else's or already reverted", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Revertivel", transactionCount: 0 } });
    const first = out<{ planId: string }>(await run(proposeRevertPlan, { statementImportId: imp.id }));
    const second = out<{ planId: string }>(await run(proposeRevertPlan, { statementImportId: imp.id }));
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: first.planId } })).status).toBe("superseded");
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: second.planId } })).status).toBe("proposed");

    const theirs = await prisma.import.create({ data: { userId: OTHER, entityId: other.pfId, bankName: "Alheio", transactionCount: 0 } });
    await expect(run(proposeRevertPlan, { statementImportId: theirs.id })).rejects.toThrow("Statement import not found or access denied");
    await expect(run(proposeRevertPlan, { statementImportId: "missing-import" })).rejects.toThrow("Statement import not found or access denied");

    const reverted = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Ja revertido", transactionCount: 0, revertedAt: new Date() } });
    await expect(run(proposeRevertPlan, { statementImportId: reverted.id })).rejects.toThrow("This import was already reverted");
  });
});

describe("present_card", () => {
  const pair = (id: string) => ({
    pairId: id,
    incoming: { description: "PADARIA SP", date: "2026-09-02", amount: 18, type: "expense" },
    existing: { id: "entry-1", description: "Padaria", date: "2026-09-03", amount: 18, type: "expense" },
    confidence: "medium",
    reason: "Mesmo valor, um dia de diferenca",
    diffs: [{ field: "date", existingValue: "2026-09-03", incomingValue: "2026-09-02" }],
  });

  it("echoes the pairs back as a pending card with a fresh id, writing nothing", async () => {
    const entries = await prisma.ledgerEntry.count({ where: { userId: USER } });
    const first = out<{ cardId: string; cardType: string; pairs: unknown[]; status: string }>(await run(presentCard, { cardType: "duplicate_review", pairs: [pair("p1"), pair("p2")] }));
    const second = out<{ cardId: string }>(await run(presentCard, { cardType: "duplicate_review", pairs: [pair("p1")] }));
    expect(first).toMatchObject({ cardType: "duplicate_review", status: "pending", pairs: [pair("p1"), pair("p2")] });
    expect(first.cardId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.cardId).not.toBe(first.cardId);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entries);
  });

  it("is a read tool: no audit row, and malformed cards never reach it", async () => {
    const ok = await executeTool([presentCard], ctx, "tool-card", "present_card", { cardType: "duplicate_review", pairs: [pair("p1")] });
    expect(ok.isError).toBe(false);
    expect(await prisma.agentAction.count({ where: { conversationId: ctx.conversationId, toolName: "present_card" } })).toBe(0);

    for (const bad of [{ cardType: "duplicate_review", pairs: [] }, { cardType: "other", pairs: [pair("p1")] }, { cardType: "duplicate_review", pairs: [{ ...pair("p1"), confidence: "certain" }] }]) {
      const result = await executeTool([presentCard], ctx, "tool-bad", "present_card", bad);
      expect(result.isError).toBe(true);
    }
  });
});
