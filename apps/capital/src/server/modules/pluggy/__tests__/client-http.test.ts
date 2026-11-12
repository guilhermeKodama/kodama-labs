import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ PLUGGY_CLIENT_ID: "client-id" as string | undefined, PLUGGY_CLIENT_SECRET: "client-secret" as string | undefined }));
vi.mock("@/env", () => ({ env: envMock }));

import { createPluggyClient, safeSyncError } from "../lib/client";
import { isPluggyConfigured } from "../lib/config";

type Call = { url: string; init: RequestInit | undefined };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake Pluggy: POST /auth hands out `key-N`, every other path is answered by `routes`. */
function fakePluggy(routes: (url: URL, init: RequestInit | undefined) => Response | undefined) {
  const calls: Call[] = [];
  let auths = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    if (url.pathname === "/auth") {
      auths += 1;
      return json({ apiKey: `key-${auths}` });
    }
    return routes(url, init) ?? json({ message: "no route" }, 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, auths: () => auths };
}

beforeEach(() => {
  envMock.PLUGGY_CLIENT_ID = "client-id";
  envMock.PLUGGY_CLIENT_SECRET = "client-secret";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isPluggyConfigured", () => {
  it("needs both the client id and the secret", () => {
    expect(isPluggyConfigured()).toBe(true);
    envMock.PLUGGY_CLIENT_SECRET = undefined;
    expect(isPluggyConfigured()).toBe(false);
    envMock.PLUGGY_CLIENT_SECRET = "client-secret";
    envMock.PLUGGY_CLIENT_ID = undefined;
    expect(isPluggyConfigured()).toBe(false);
    envMock.PLUGGY_CLIENT_ID = "";
    expect(isPluggyConfigured()).toBe(false);
  });
});

describe("createPluggyClient authentication", () => {
  it("posts the credentials once and sends the key as X-API-KEY, reusing it for later calls", async () => {
    const pluggy = fakePluggy(() => json({ id: "item-1", status: "UPDATED" }));
    const client = createPluggyClient(pluggy.fetchImpl);

    await client.getItem("item-1");
    await client.getItem("item-1");

    const auth = pluggy.calls[0]!;
    expect(auth.url).toBe("https://api.pluggy.ai/auth");
    expect(auth.init?.method).toBe("POST");
    expect(auth.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(auth.init?.body))).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
    expect(pluggy.auths()).toBe(1);
    const reads = pluggy.calls.filter((call) => !call.url.endsWith("/auth"));
    expect(reads).toHaveLength(2);
    expect(reads.every((call) => (call.init?.headers as Record<string, string>)["X-API-KEY"] === "key-1")).toBe(true);
  });

  it("asks for a new key once the cached one is near its two-hour limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T10:00:00.000Z"));
    const pluggy = fakePluggy(() => json({ id: "item-1" }));
    const client = createPluggyClient(pluggy.fetchImpl);

    await client.getItem("item-1");
    vi.setSystemTime(new Date("2026-10-19T11:00:00.000Z"));
    await client.getItem("item-1");
    expect(pluggy.auths()).toBe(1);

    // 110 minutes after the first call, less the one-minute margin, the key is renewed.
    vi.setSystemTime(new Date("2026-10-19T11:50:00.000Z"));
    await client.getItem("item-1");
    expect(pluggy.auths()).toBe(2);
    const lastRead = pluggy.calls[pluggy.calls.length - 1]!;
    expect((lastRead.init?.headers as Record<string, string>)["X-API-KEY"]).toBe("key-2");
  });

  it("refuses to call Pluggy without credentials", async () => {
    envMock.PLUGGY_CLIENT_SECRET = undefined;
    const pluggy = fakePluggy(() => json({}));
    await expect(createPluggyClient(pluggy.fetchImpl).getItem("item-1")).rejects.toThrow("Pluggy is not configured");
    expect(pluggy.fetchImpl).not.toHaveBeenCalled();
    envMock.PLUGGY_CLIENT_SECRET = "client-secret";
    envMock.PLUGGY_CLIENT_ID = undefined;
    await expect(createPluggyClient(pluggy.fetchImpl).getItem("item-1")).rejects.toThrow("Pluggy is not configured");
  });

  it("fails when /auth answers without an api key", async () => {
    const fetchImpl = vi.fn(async () => json({ message: "ok but empty" })) as unknown as typeof fetch;
    await expect(createPluggyClient(fetchImpl).getItem("item-1")).rejects.toThrow("Pluggy authentication failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces the status of a failed read without the body", async () => {
    const pluggy = fakePluggy(() => json({ message: "secret detail 123456789" }, 503));
    const error = await createPluggyClient(pluggy.fetchImpl)
      .getAccounts("item-1")
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error?.message).toBe("Pluggy request failed (503)");
  });
});

describe("createPluggyClient reads", () => {
  it("reads one item by its encoded id", async () => {
    const pluggy = fakePluggy((url) => (url.pathname === "/items/a%2Fb%20c" ? json({ id: "a/b c", status: "UPDATED", consentExpiresAt: "2027-01-01T00:00:00.000Z" }) : undefined));
    const item = await createPluggyClient(pluggy.fetchImpl).getItem("a/b c");
    expect(item).toEqual({ id: "a/b c", status: "UPDATED", consentExpiresAt: "2027-01-01T00:00:00.000Z" });
  });

  it("follows every page of accounts and treats a page without results as empty", async () => {
    const pluggy = fakePluggy((url) => {
      if (url.pathname !== "/accounts") return undefined;
      expect(url.searchParams.get("itemId")).toBe("item-1");
      expect(url.searchParams.get("pageSize")).toBe("500");
      const page = Number(url.searchParams.get("page"));
      if (page === 1) return json({ results: [{ id: "a1", type: "BANK" }], page: 1, totalPages: 3 });
      if (page === 2) return json({ page: 2, totalPages: 3 });
      return json({ results: [{ id: "a3", type: "CREDIT" }], page: 3, totalPages: 3 });
    });
    const accounts = await createPluggyClient(pluggy.fetchImpl).getAccounts("item-1");
    expect(accounts.map((account) => account.id)).toEqual(["a1", "a3"]);
    expect(pluggy.calls.filter((call) => call.url.includes("/accounts"))).toHaveLength(3);
  });

  it("stops after the first page when the response carries no page count", async () => {
    const pluggy = fakePluggy((url) => (url.pathname === "/investments" ? json({ results: [{ id: "inv-1" }] }) : undefined));
    const investments = await createPluggyClient(pluggy.fetchImpl).getInvestments("item-1");
    expect(investments).toEqual([{ id: "inv-1" }]);
    expect(pluggy.calls.filter((call) => call.url.includes("/investments"))).toHaveLength(1);
  });

  it("drops bank transactions older than the window even if Pluggy returns them", async () => {
    const pluggy = fakePluggy((url) => {
      if (url.pathname !== "/transactions") return undefined;
      expect(url.searchParams.get("accountId")).toBe("acc-1");
      expect(url.searchParams.get("from")).toBe("2026-10-12");
      return json({
        results: [
          { id: "old", amount: 1, date: "2026-10-11T23:59:59.000Z", type: "DEBIT" },
          { id: "edge", amount: 2, date: "2026-10-12T00:00:00.000Z", type: "DEBIT" },
          { id: "new", amount: 3, date: "2026-10-15T00:00:00.000Z", type: "CREDIT" },
        ],
      });
    });
    const rows = await createPluggyClient(pluggy.fetchImpl).getTransactions("acc-1", "2026-10-12");
    expect(rows.map((row) => row.id)).toEqual(["edge", "new"]);
  });

  it("filters investment transactions by trade date, falling back to the booking date", async () => {
    const pluggy = fakePluggy((url) => {
      if (url.pathname !== "/investments/inv%2F1/transactions") return undefined;
      return json({
        results: [
          { id: "traded-old", amount: 1, date: "2026-10-20T00:00:00.000Z", tradeDate: "2026-10-01T00:00:00.000Z", type: "BUY" },
          { id: "traded-new", amount: 1, date: "2026-10-01T00:00:00.000Z", tradeDate: "2026-10-18T00:00:00.000Z", type: "BUY" },
          { id: "no-trade-date", amount: 1, date: "2026-10-16T00:00:00.000Z", tradeDate: null, type: "INTEREST" },
          { id: "no-trade-date-old", amount: 1, date: "2026-10-02T00:00:00.000Z", type: "INTEREST" },
        ],
      });
    });
    const rows = await createPluggyClient(pluggy.fetchImpl).getInvestmentTransactions("inv/1", "2026-10-10");
    expect(rows.map((row) => row.id)).toEqual(["traded-new", "no-trade-date"]);
    expect(pluggy.calls[pluggy.calls.length - 1]!.url).toBe("https://api.pluggy.ai/investments/inv%2F1/transactions?pageSize=500&page=1");
  });
});

describe("safeSyncError", () => {
  it("keeps an error's message but redacts long digit runs", () => {
    expect(safeSyncError(new Error("Pluggy request failed for account 001234567890"))).toBe("Pluggy request failed for account ••••");
    expect(safeSyncError(new Error("cpf 123.456.789-00"))).toBe("cpf ••••");
  });

  it("caps the message at 300 characters", () => {
    expect(safeSyncError(new Error("x".repeat(500)))).toHaveLength(300);
  });

  it("uses a generic message for anything that is not an Error", () => {
    expect(safeSyncError("boom 123456789")).toBe("sync failed");
    expect(safeSyncError(undefined)).toBe("sync failed");
  });
});
