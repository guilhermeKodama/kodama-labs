import { describe, expect, it } from "vitest";
import { createApp } from "@capital/server/lib/create-app";
import ledgerRoutes from "../v2";

/** The ledger router is split per resource; every route keeps its method and URL. */
const EXPECTED = [
  "POST /v2/ledger/query",
  "POST /v2/ledger/export",
  "GET /v2/ledger/entries/{id}",
  "POST /v2/ledger/entries",
  "PATCH /v2/ledger/entries/{id}",
  "DELETE /v2/ledger/entries/{id}",
  "GET /v2/ledger/entries/{id}/delete-options",
  "POST /v2/ledger/entries/{id}/delete",
  "GET /v2/ledger/entries/{id}/history",
  "POST /v2/ledger/bulk",
  "GET /v2/mutations",
  "POST /v2/mutations/{id}/undo",
  "GET /v2/trash",
  "POST /v2/trash/restore",
  "DELETE /v2/trash",
  "GET /v2/views",
  "POST /v2/views",
  "PATCH /v2/views/{id}",
  "DELETE /v2/views/{id}",
  "POST /v2/views/{id}/duplicate",
  "PUT /v2/views/order",
  "GET /v2/entities",
  "POST /v2/entities",
  "PATCH /v2/entities/{id}",
  "GET /v2/accounts",
  "POST /v2/accounts",
  "PATCH /v2/accounts/{id}",
  "POST /v2/accounts/{id}/set-balance",
  "GET /v2/accounts/{id}/statements",
  "POST /v2/card-statements/{id}/payment",
  "DELETE /v2/card-statements/payment/{id}",
  "GET /v2/rules",
  "POST /v2/rules",
  "PATCH /v2/rules/{id}",
  "DELETE /v2/rules/{id}",
  "POST /v2/rules/test",
  "POST /v2/rules/suggest",
].sort();

describe("ledger v2 route table", () => {
  it("serves the same methods and paths after the split", () => {
    const served = ledgerRoutes.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`);
    expect([...new Set(served)].sort()).toEqual(EXPECTED);
  });

  it("documents every route in the app's OpenAPI spec", async () => {
    const res = await createApp().request("/api/doc");
    expect(res.status).toBe(200);
    const paths = (await res.json()).paths as Record<string, Record<string, unknown>>;
    const documented = Object.entries(paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
    expect(documented).toEqual(expect.arrayContaining(EXPECTED.map((r) => r.replace(" /v2/", " /api/v2/"))));
  });
});
