import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";

/** The v1 routes (assistant, FIRE) answer errors with the same coded envelope as v2. */
const USER = "test-user-v1-error-codes-001";
const MISSING = "00000000-0000-0000-0000-000000000000";
const app = createApp();
let cookie: string;

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("v1 error envelope", () => {
  it("codes a missing or foreign conversation", async () => {
    expect(await call("GET", `/v1/assistant/conversations/${MISSING}`)).toEqual({
      status: 404,
      body: { message: "Conversation not found or access denied", code: "assistant.conversation_not_found" },
    });
    expect(await call("POST", `/v1/assistant/conversations/${MISSING}/cancel`)).toEqual({
      status: 404,
      body: { message: "Conversation not found", code: "assistant.conversation_not_found" },
    });
    expect((await call("DELETE", `/v1/assistant/conversations/${MISSING}`)).body).toMatchObject({ code: "assistant.conversation_not_found" });
    expect((await call("POST", `/v1/assistant/conversations/${MISSING}/messages`, { text: "oi" })).body).toMatchObject({ code: "assistant.conversation_not_found" });

    const form = new FormData();
    const upload = await app.request(`/api/v1/assistant/conversations/${MISSING}/files`, { method: "POST", headers: { cookie }, body: form });
    expect(upload.status).toBe(400);
    expect(await upload.json()).toEqual({ message: "file is required", code: "assistant.file_required" });
  });

  it("codes message and plan errors", async () => {
    const created = await call("POST", "/v1/assistant/conversations", { title: "Erros" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    expect(await call("POST", `/v1/assistant/conversations/${id}/messages`, {})).toEqual({
      status: 400,
      body: { message: "text, cardResponse or fileIds is required", code: "assistant.message_required" },
    });
    const invalid = await call("POST", `/v1/assistant/conversations/${id}/messages`, { text: "" });
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ code: "validation", issues: [expect.objectContaining({ path: "text" })] });

    expect((await call("POST", `/v1/assistant/conversations/${id}/plans/${MISSING}/confirm`, { payloadHash: "x" })).body).toMatchObject({
      code: "assistant.plan_not_found",
    });
    const plan = await prisma.importPlan.create({ data: { conversationId: id, userId: USER, payload: {}, payloadHash: "abc", summary: {} } });
    expect(await call("POST", `/v1/assistant/conversations/${id}/plans/${plan.id}/confirm`, { payloadHash: "stale" })).toEqual({
      status: 400,
      body: { message: "payloadHash does not match - the plan changed since it was displayed, re-read it before confirming", code: "assistant.plan_changed" },
    });
    expect((await call("POST", `/v1/assistant/conversations/${id}/plans/${plan.id}/reject`)).status).toBe(200);
    expect(await call("POST", `/v1/assistant/conversations/${id}/plans/${plan.id}/confirm`, { payloadHash: "abc" })).toEqual({
      status: 400,
      body: { message: 'Plan is "rejected", not "proposed"', code: "assistant.plan_not_proposed", params: { status: "rejected" } },
    });
  });

  it("codes FIRE errors", async () => {
    expect(await call("POST", "/v1/fire/snapshot", {})).toEqual({ status: 400, body: { message: "No FIRE plan to snapshot", code: "fire.no_plan" } });
  });
});
