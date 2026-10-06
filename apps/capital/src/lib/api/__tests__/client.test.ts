import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiPost, isUnauthenticated, parseApiError, withQuery } from "@/lib/api/client";

describe("parseApiError", () => {
  it("reads the v2 envelope", () => {
    const error = parseApiError(409, { message: "A newer change touched these rows", code: "undo.newer_change", params: { count: 2 } });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "undo.newer_change", params: { count: 2 }, issues: [], message: "A newer change touched these rows" });
  });

  it("reads 422 validation issues", () => {
    const error = parseApiError(422, {
      message: "Invalid input",
      code: "validation",
      issues: [
        { path: "amount", code: "too_small", message: "Must be positive" },
        { path: ["legs", 0, "accountId"], code: "invalid_type", message: "Required" },
      ],
    });
    expect(error.code).toBe("validation");
    expect(error.issues).toEqual([
      { path: "amount", code: "too_small", message: "Must be positive" },
      { path: "legs.0.accountId", code: "invalid_type", message: "Required" },
    ]);
  });

  it("reads the v1 envelope", () => {
    const error = parseApiError(404, { error: { code: "NOT_FOUND", message: "Conversation not found" } });
    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", message: "Conversation not found" });
  });

  it("reads stoker's default validation hook as a validation error", () => {
    const error = parseApiError(422, {
      success: false,
      error: { name: "ZodError", issues: [{ path: ["description"], code: "too_small", message: "Required" }] },
    });
    expect(error.code).toBe("validation");
    expect(error.issues).toEqual([{ path: "description", code: "too_small", message: "Required" }]);
  });

  it("keeps only the status for bodies it does not understand", () => {
    expect(parseApiError(502, null, "Bad Gateway")).toMatchObject({ status: 502, code: null, message: "Bad Gateway", params: {}, issues: [] });
    expect(parseApiError(500, "<html>oops</html>")).toMatchObject({ code: null, message: "<html>oops</html>" });
    expect(parseApiError(500, undefined).message).toBe("HTTP 500");
    expect(parseApiError(400, { message: 42, code: ["x"], params: "nope" })).toMatchObject({ code: null, params: {}, message: "HTTP 400" });
  });

  it("ignores malformed issues", () => {
    const error = parseApiError(422, { issues: [null, "x", { message: "Required" }] });
    expect(error.issues).toEqual([{ path: "", code: "invalid", message: "Required" }]);
  });
});

describe("withQuery", () => {
  it("skips empty values and joins arrays", () => {
    expect(withQuery("/api/v2/quotes", { tickers: ["PETR4", "VALE3"], scope: "pf", none: undefined, nil: null, empty: [] })).toBe(
      "/api/v2/quotes?tickers=PETR4%2CVALE3&scope=pf",
    );
    expect(withQuery("/api/v2/mutations", { undoable: true, limit: 1 })).toBe("/api/v2/mutations?undoable=true&limit=1");
    expect(withQuery("/api/v2/x?a=1", { b: 2 })).toBe("/api/v2/x?a=1&b=2");
    expect(withQuery("/api/v2/x", {})).toBe("/api/v2/x");
  });
});

describe("api", () => {
  const fetchMock = vi.fn<typeof fetch>();
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });
  const respond = (body: BodyInit | null, init: ResponseInit) => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(body, init));
  };

  it("sends JSON with the session cookie and no HTTP cache", async () => {
    respond(JSON.stringify({ batchId: "b1" }), { status: 200, headers: { "content-type": "application/json" } });
    await expect(apiPost("/api/v2/ledger/entries", { amount: 1 })).resolves.toEqual({ batchId: "b1" });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/v2/ledger/entries");
    expect(init).toMatchObject({ method: "POST", credentials: "include", cache: "no-store", body: '{"amount":1}' });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("returns text for CSV and undefined for 204", async () => {
    respond("a;b\n1;2", { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } });
    await expect(api("/api/v2/ledger/export")).resolves.toBe("a;b\n1;2");
    respond(null, { status: 204 });
    await expect(api("/api/v2/x")).resolves.toBeUndefined();
  });

  it("throws ApiError with the envelope's code", async () => {
    respond(JSON.stringify({ message: "Category is archived", code: "category.archived" }), { status: 422, headers: { "content-type": "application/json" } });
    const error = await api("/api/v2/ledger/entries").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "category.archived" });
  });

  it("turns network failures into status 0 and rethrows aborts", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api("/api/v2/me")).rejects.toMatchObject({ status: 0, code: "network" });
    const abort = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockRejectedValueOnce(abort);
    await expect(api("/api/v2/me")).rejects.toBe(abort);
  });
});

describe("isUnauthenticated", () => {
  it("is true for 401 and 403 only", () => {
    expect(isUnauthenticated(new ApiError({ status: 401, message: "" }))).toBe(true);
    expect(isUnauthenticated(new ApiError({ status: 403, message: "" }))).toBe(true);
    expect(isUnauthenticated(new ApiError({ status: 404, message: "" }))).toBe(false);
    expect(isUnauthenticated(new Error("401"))).toBe(false);
  });
});
