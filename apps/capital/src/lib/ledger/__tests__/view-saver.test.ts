import { describe, expect, it } from "vitest";
import { createViewSaver, insertView, patchView, removeView } from "@/lib/ledger/view-saver";

type Body = { name?: string; config?: { filters: string[] } };

/** A server whose answers resolve when the test says so, in any order. */
function fakeServer() {
  const calls: { id: string; body: Body; resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  const send = (id: string, body: Body) =>
    new Promise((resolve, reject) => {
      calls.push({ id, body, resolve, reject });
    });
  return { calls, send };
}

/** The debounce timer, fired by hand. */
function manualTimer() {
  let next: (() => void) | null = null;
  return {
    setTimer: (fn: () => void) => {
      next = fn;
      return fn;
    },
    clearTimer: () => {
      next = null;
    },
    fire: () => {
      const fn = next;
      next = null;
      fn?.();
    },
  };
}

/** Lets the queued promises run. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("view saver", () => {
  it("merges the edits made inside the delay into one PATCH per view, the last value winning", async () => {
    const server = fakeServer();
    const timer = manualTimer();
    const saver = createViewSaver<Body, unknown>({ send: server.send, delay: 250, ...timer });
    saver.save("v1", { config: { filters: ["a"] } });
    saver.save("v1", { name: "Mercado" });
    saver.save("v1", { config: { filters: ["a", "b"] } });
    expect(server.calls).toHaveLength(0);
    timer.fire();
    await settle();
    expect(server.calls).toEqual([expect.objectContaining({ id: "v1", body: { name: "Mercado", config: { filters: ["a", "b"] } } })]);
  });

  it("sends one PATCH at a time, in edit order, and hands back only the answer of the latest edit", async () => {
    const server = fakeServer();
    const timer = manualTimer();
    const saved: [string, unknown][] = [];
    const saver = createViewSaver<Body, unknown>({ send: server.send, delay: 250, ...timer, onSaved: (id, view) => saved.push([id, view]) });

    saver.save("v1", { config: { filters: ["a"] } });
    timer.fire();
    await settle();
    // A second click while the first PATCH is in flight waits for it.
    saver.save("v1", { config: { filters: ["a", "b"] } });
    timer.fire();
    await settle();
    expect(server.calls.map((c) => c.body)).toEqual([{ config: { filters: ["a"] } }]);

    server.calls[0].resolve({ id: "v1", filters: ["a"] });
    await settle();
    expect(server.calls.map((c) => c.body)).toEqual([{ config: { filters: ["a"] } }, { config: { filters: ["a", "b"] } }]);
    // The first answer is older than the edit on screen: not written back.
    expect(saved).toEqual([]);

    server.calls[1].resolve({ id: "v1", filters: ["a", "b"] });
    await settle();
    expect(saved).toEqual([["v1", { id: "v1", filters: ["a", "b"] }]]);
  });

  it("drops what is waiting for a deleted view and ignores the error of its PATCH in flight", async () => {
    const server = fakeServer();
    const timer = manualTimer();
    const errors: string[] = [];
    const saver = createViewSaver<Body, unknown>({ send: server.send, delay: 250, ...timer, onError: (id) => errors.push(id) });

    saver.save("v1", { name: "Antes" });
    timer.fire();
    await settle();
    saver.save("v1", { name: "Depois" });
    saver.save("v2", { name: "Outra" });
    saver.drop("v1");
    timer.fire();
    await settle();
    // The PATCH already sent fails with a 404 once the view is gone: not reported.
    server.calls[0].reject(new Error("404"));
    await settle();
    expect(errors).toEqual([]);
    expect(server.calls.map((c) => c.id)).toEqual(["v1", "v2"]);
    expect(saver.isDropped("v1")).toBe(true);

    // A view brought back (undo) saves again, and its failures are reported.
    saver.save("v1", { name: "De volta" });
    expect(saver.isDropped("v1")).toBe(false);
    timer.fire();
    server.calls[1].resolve({});
    await settle();
    server.calls[2].reject(new Error("500"));
    await settle();
    expect(errors).toEqual(["v1"]);
  });

  it("hands what is waiting to the page-hide keepalive and stops the timer", () => {
    const server = fakeServer();
    const timer = manualTimer();
    const saver = createViewSaver<Body, unknown>({ send: server.send, delay: 250, ...timer });
    saver.save("v1", { name: "a" });
    expect(saver.waiting()).toBe(true);
    expect(saver.takePending()).toEqual([["v1", { name: "a" }]]);
    expect(saver.waiting()).toBe(false);
    timer.fire();
    expect(server.calls).toEqual([]);
  });
});

describe("views cache helpers", () => {
  const list = [
    { id: "all", name: "Todas", config: { layout: "table" } },
    { id: "v1", name: "Mercado", config: { layout: "pivot" } },
  ];

  it("inserts a created view once, at the end", () => {
    const created = { id: "v2", name: "Nova view", config: { layout: "table" } };
    expect(insertView(list, created)?.map((v) => v.id)).toEqual(["all", "v1", "v2"]);
    expect(insertView(insertView(list, created), created)?.map((v) => v.id)).toEqual(["all", "v1", "v2"]);
    expect(insertView(undefined, created)).toBeUndefined();
  });

  it("patches a view in place (the config as a whole) and removes a deleted one", () => {
    expect(patchView(list, "v1", { name: "Feira" })?.[1]).toEqual({ id: "v1", name: "Feira", config: { layout: "pivot" } });
    expect(patchView(list, "v1", { config: { layout: "chart" } })?.[1].config).toEqual({ layout: "chart" });
    expect(removeView(list, "v1")?.map((v) => v.id)).toEqual(["all"]);
  });
});
