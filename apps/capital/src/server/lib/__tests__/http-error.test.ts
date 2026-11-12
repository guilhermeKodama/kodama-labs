import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AppBindings } from "../../types";
import { HttpError, notFoundHandler, onError, readFormBody, toHttpError, validationError, zodIssues } from "../http-error";

afterEach(() => {
  vi.unstubAllEnvs();
});

function appThatThrows(error: unknown) {
  const app = new Hono<AppBindings>();
  app.onError(onError);
  app.get("/boom", () => {
    throw error;
  });
  return app;
}

describe("zodIssues / validationError", () => {
  it("flattens each issue to a dotted path, a code and a message", () => {
    const error = new ZodError([
      { code: "custom", path: ["rows", 0, "date"], message: "Bad date" },
      { code: "custom", path: [], message: "Body required" },
    ]);
    expect(zodIssues(error)).toEqual([
      { path: "rows.0.date", code: "custom", message: "Bad date" },
      { path: "", code: "custom", message: "Body required" },
    ]);
  });

  it("builds a 422 whose message lists 'path: message' for each issue and bare messages for pathless ones", () => {
    const error = validationError(
      new ZodError([
        { code: "custom", path: ["amount"], message: "Must be positive" },
        { code: "custom", path: [], message: "Body required" },
      ]),
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation");
    expect(error.message).toBe("amount: Must be positive; Body required");
    expect(error.issues).toHaveLength(2);
  });

  it("says 'Invalid request' when the ZodError carries no issue", () => {
    expect(validationError(new ZodError([])).message).toBe("Invalid request");
  });
});

describe("toHttpError", () => {
  it("keeps an HttpError as it is", () => {
    const error = new HttpError(409, "Taken", { code: "duplicate" });
    expect(toHttpError(error)).toBe(error);
  });

  it("turns Hono's own 400 into a bad_request HttpError", () => {
    const mapped = toHttpError(new HTTPException(400, { message: "Malformed JSON in request body" }));
    expect(mapped).toBeInstanceOf(HttpError);
    expect(mapped).toMatchObject({ status: 400, code: "bad_request", message: "Malformed JSON in request body" });
  });

  it("leaves another plain HTTPException status alone", () => {
    const error = new HTTPException(413, { message: "Payload too large" });
    expect(toHttpError(error)).toBe(error);
  });

  it("maps a message that says 'access denied' to 404 not_found, like 'not found'", () => {
    expect(toHttpError(new Error("Account access denied"))).toMatchObject({ status: 404, code: "not_found", message: "Account access denied" });
    expect(toHttpError(new Error("Entry NOT FOUND"))).toMatchObject({ status: 404, code: "not_found" });
  });

  it("returns anything else unchanged", () => {
    const error = new Error("disk full");
    expect(toHttpError(error)).toBe(error);
    expect(toHttpError("a string")).toBe("a string");
  });
});

describe("readFormBody", () => {
  const contextWith = (parseBody: () => Promise<unknown>) => ({ req: { parseBody } }) as unknown as Context;

  it("returns the parsed form", async () => {
    await expect(readFormBody(contextWith(async () => ({ file: "x" })))).resolves.toEqual({ file: "x" });
  });

  it("answers 400 bad_request with the parser's message", async () => {
    await expect(readFormBody(contextWith(async () => Promise.reject(new Error("boundary missing"))))).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
      message: "boundary missing",
    });
  });

  it("uses a generic message when the parser rejects with something that is not an Error", async () => {
    await expect(readFormBody(contextWith(async () => Promise.reject("nope")))).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
      message: "Malformed form data",
    });
  });
});

describe("onError", () => {
  it("shows the stack of a 5xx outside production", async () => {
    const res = await appThatThrows(new Error("kaboom")).request("/boom");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("kaboom");
    expect(body.stack).toContain("kaboom");
  });

  it("hides the stack of a 5xx in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await appThatThrows(new Error("kaboom")).request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "kaboom" });
  });

  it("keeps the status of an error that has one in the 4xx-5xx range", async () => {
    const error = Object.assign(new Error("teapot"), { status: 418 });
    const res = await appThatThrows(error).request("/boom");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ message: "teapot" });
  });

  it("falls back to 500 for a status outside the error range", async () => {
    const res = await appThatThrows(Object.assign(new Error("odd"), { status: 302 })).request("/boom");
    expect(res.status).toBe(500);
    const res2 = await appThatThrows(Object.assign(new Error("odd"), { status: 700 })).request("/boom");
    expect(res2.status).toBe(500);
  });

  it("sends the envelope of an HttpError with its params and issues", async () => {
    const error = new HttpError(422, "Bad", { code: "validation", params: { name: "x", max: 3 }, issues: [{ path: "a", code: "custom", message: "m" }] });
    const res = await appThatThrows(error).request("/boom");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ message: "Bad", code: "validation", params: { name: "x", max: 3 }, issues: [{ path: "a", code: "custom", message: "m" }] });
  });
});

describe("notFoundHandler", () => {
  it("answers 404 with the not_found code and the requested path", async () => {
    const app = new Hono<AppBindings>();
    app.notFound(notFoundHandler);
    const res = await app.request("/api/missing/thing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found - /api/missing/thing", code: "not_found" });
  });
});
