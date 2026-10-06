import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

/** HTTP: display queries, export by ids, the sankey, default views (lazy and at signup) and duplicate with a config. */
const USER = "test-user-v2-views-query-001";
const SIGNUP_EMAIL = "test-user-v2-views-signup-001@example.com";
const app = createApp();
let f: LedgerFixture;
let cookie: string;
let transferLegs: string[];

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, json: json as Record<string, unknown>, text };
}

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
  await call("POST", "/v2/ledger/entries", { kind: "income", accountId: f.pjChecking, amount: 5000, description: "Invoice", date: "2026-09-02" });
  await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 80, description: "Padaria", date: "2026-09-03" });
  const t = await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 1000, date: "2026-09-04" });
  transferLegs = (t.json as { entryIds: string[] }).entryIds;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await prisma.user.deleteMany({ where: { email: SIGNUP_EMAIL } });
});

describe("v2 views and query routes", () => {
  it("answers display queries with the KPI summary and one row per transfer", async () => {
    const r = await call("POST", "/v2/ledger/query", { semantics: "display", period: { from: "2026-09-01", to: "2026-09-30" } });
    expect(r.status).toBe(200);
    expect(r.json.summary).toEqual({ income: 5000, expense: 80, investment: 0, net: 4920, count: 3 });
    const rows = r.json.rows as { neutral: boolean; legIds: string[]; displayAmount: number }[];
    expect(rows.filter((x) => x.neutral)).toEqual([expect.objectContaining({ legIds: transferLegs, displayAmount: 1000 })]);
    const legs = await call("POST", "/v2/ledger/query", { period: { from: "2026-09-01", to: "2026-09-30" } });
    expect((legs.json.totals as { count: number }).count).toBe(4);
    expect(legs.json.summary).toBeUndefined();
    const bad = await call("POST", "/v2/ledger/query", { semantics: "rows" });
    expect(bad.status).toBe(422);
    expect(bad.json.code).toBe("validation");
  });

  it("exports rows by id with both legs of a transfer", async () => {
    const r = await call("POST", "/v2/ledger/export", { ids: [transferLegs[1]] });
    expect(r.status).toBe(200);
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("Data,Descrição,Entidade,Conta,Categoria,Tipo,Valor,Moeda,Valor na moeda base,Observações");
    expect(lines.slice(1).map((l) => l.split(",")[5])).toEqual(["Transferência", "Transferência"]);
  });

  it("returns the cash-flow sankey", async () => {
    const r = await call("POST", "/v2/ledger/flows", { period: { from: "2026-09-01", to: "2026-09-30" } });
    expect(r.status).toBe(200);
    expect(r.json.totals).toEqual({ income: 5000, expenses: 80, investments: 0, surplus: 4920, reserves: 0, priorBalance: 0 });
    const nodes = r.json.nodes as { id: string }[];
    const links = r.json.links as { source: number; target: number; value: number }[];
    const pj = nodes.findIndex((n) => n.id === `entity::${f.pjId}`);
    const pf = nodes.findIndex((n) => n.id === `entity::${f.pfId}`);
    expect(links.find((l) => l.source === pj && l.target === pf)?.value).toBe(1000);
  });

  it("seeds the default views on first GET and duplicates a view with the config on screen", async () => {
    const holdings = await call("GET", "/v2/views?dataset=holdings");
    expect((holdings.json as unknown as { seedKey: string }[]).map((v) => v.seedKey)).toEqual(["byClass", "byBroker", "byEntity", "list"]);
    const notExportable = await call("POST", "/v2/ledger/export", { viewId: (holdings.json as unknown as { id: string }[])[0].id });
    expect(notExportable.status).toBe(422);
    expect(notExportable.json.code).toBe("view.not_exportable");

    const ledger = (await call("GET", "/v2/views?dataset=ledger")).json as unknown as { id: string; builtinKey: string | null; seedKey: string | null; config: Record<string, unknown> }[];
    expect(ledger[0].builtinKey).toBe("all");
    expect(ledger.find((v) => v.seedKey === "ir")).toBeDefined();
    const config = { ...ledger[0].config, filters: [{ field: "flowKind", op: "in", values: ["in"] }] };
    const copy = await call("POST", `/v2/views/${ledger[0].id}/duplicate`, { config });
    expect(copy.status).toBe(200);
    expect(copy.json).toMatchObject({ name: "Todas (cópia)", isBuiltin: false, config: { filters: [{ field: "flowKind", op: "in", values: ["in"] }] } });
    const invalid = await call("POST", `/v2/views/${ledger[0].id}/duplicate`, { config: { layout: "spreadsheet" } });
    expect(invalid.status).toBe(422);
  });

  it("seeds the default views at signup", async () => {
    await prisma.user.deleteMany({ where: { email: SIGNUP_EMAIL } });
    const res = await call("POST", "/v2/auth/signup", { email: SIGNUP_EMAIL, password: "secret-123", name: "New" }, {});
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SIGNUP_EMAIL }, select: { id: true, viewsSeedVersion: true } });
    expect(user.viewsSeedVersion).toBe(1);
    const seeded = await prisma.savedView.findMany({ where: { userId: user.id, seedKey: { not: null } }, select: { seedKey: true } });
    // No business yet: everything but "PJ" and "Impostos PJ".
    expect(seeded.map((v) => v.seedKey).sort()).toEqual(
      ["balance", "board", "byBroker", "byClass", "byEntity", "cal", "cat", "flow", "income12m", "ir", "list", "operations", "pivot", "subs", "trend"].sort()
    );
  });
});
