import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { announceWrite, configureUndo, pushUndo, rememberUndo, undoBatch, undoLast, undoStack } from "@/lib/api/undo";
import { createUndoStack, latestUndoable, readBatchId } from "@/lib/api/undo-stack";

// vi.mock is hoisted above the imports.
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

describe("createUndoStack", () => {
  it("pops newest first and keeps a batch once", () => {
    const stack = createUndoStack();
    stack.push({ batchId: "a", message: "A" });
    stack.push({ batchId: "b", message: "B" });
    stack.push({ batchId: "a", message: "A again" });
    expect(stack.size()).toBe(2);
    expect(stack.pop()).toEqual({ batchId: "a", message: "A again" });
    expect(stack.peek()).toEqual({ batchId: "b", message: "B" });
    expect(stack.pop()?.batchId).toBe("b");
    expect(stack.pop()).toBeUndefined();
  });

  it("drops the oldest past the limit and removes by id", () => {
    const stack = createUndoStack(2);
    for (const batchId of ["a", "b", "c"]) stack.push({ batchId, message: "" });
    expect(stack.size()).toBe(2);
    stack.remove("c");
    expect(stack.pop()?.batchId).toBe("b");
    expect(stack.pop()).toBeUndefined();
  });
});

describe("readBatchId", () => {
  it("reads a non-empty string batchId", () => {
    expect(readBatchId({ batchId: "b1", entry: {} })).toBe("b1");
    expect(readBatchId({ batchId: null })).toBeNull();
    expect(readBatchId({ batchId: "" })).toBeNull();
    expect(readBatchId([{ batchId: "b1" }])).toBeNull();
    expect(readBatchId(undefined)).toBeNull();
  });
});

describe("latestUndoable", () => {
  it("picks the newest batch not undone, from an array or { batches }", () => {
    const batches = [
      { id: "b3", undoneAt: "2026-10-05T12:00:00Z" },
      { id: "b2", undoneAt: null },
      { id: "b1", undoneAt: null },
    ];
    expect(latestUndoable(batches)).toBe("b2");
    expect(latestUndoable({ batches })).toBe("b2");
    expect(latestUndoable([])).toBeNull();
    expect(latestUndoable({ nope: true })).toBeNull();
  });
});

describe("undo", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    configureUndo({
      queryClient: { invalidateQueries } as unknown as QueryClient,
      label: (key) => `label:${key}`,
      errorText: (error) => `error:${(error as { code?: string }).code ?? "?"}`,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    invalidateQueries.mockClear();
    toastMock.mockClear();
    toastMock.dismiss.mockClear();
    undoStack.clear();
    configureUndo(null);
  });

  it("shows the pill with Desfazer, and its action undoes the batch", async () => {
    pushUndo("b1", "“iFood” excluída");
    expect(undoStack.peek()).toEqual({ batchId: "b1", message: "“iFood” excluída" });
    const [message, options] = toastMock.mock.calls[0] as [string, { id: string; action: { label: string; onClick: () => void } }];
    expect(message).toBe("“iFood” excluída");
    expect(options.id).toBe("undo:b1");
    expect(options.action.label).toBe("label:undo");

    fetchMock.mockResolvedValue(json({ batchId: "b1", reverted: 1 }));
    expect(await undoBatch("b1")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v2/mutations/b1/undo");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(toastMock.dismiss).toHaveBeenCalledWith("undo:b1");
    expect(undoStack.size()).toBe(0);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["ledger"] });
    // A click on the pill needs no confirmation toast.
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("announces a write: undo pill with a batch, silent ⌘Z entry without a message, plain toast without a batch", () => {
    announceWrite("b1", "Na lixeira · 2");
    expect(undoStack.peek()).toEqual({ batchId: "b1", message: "Na lixeira · 2" });
    expect(toastMock.mock.calls[0][1]).toMatchObject({ id: "undo:b1" });

    announceWrite("b2", null);
    expect(undoStack.peek()?.batchId).toBe("b2");
    expect(toastMock).toHaveBeenCalledTimes(1);

    announceWrite(null, "Na lixeira · 0");
    expect(toastMock).toHaveBeenLastCalledWith("Na lixeira · 0");
    expect(undoStack.size()).toBe(2);

    announceWrite(null, undefined);
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it("⌘Z undoes the newest batch of the tab and confirms", async () => {
    rememberUndo("b1");
    rememberUndo("b2");
    fetchMock.mockResolvedValue(json({ batchId: "b2" }));
    expect(await undoLast()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v2/mutations/b2/undo");
    expect(undoStack.peek()?.batchId).toBe("b1");
    expect(toastMock).toHaveBeenLastCalledWith("label:undone");
  });

  it("⌘Z falls back to the server's newest undoable batch", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "b9", undoneAt: "2026-10-05T10:00:00Z" }, { id: "b8", undoneAt: null }]));
    fetchMock.mockResolvedValueOnce(json({ batchId: "b8" }));
    expect(await undoLast()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v2/mutations?undoable=true&limit=1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v2/mutations/b8/undo");
  });

  it("⌘Z with nothing to undo says so", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    expect(await undoLast()).toBe(false);
    expect(toastMock).toHaveBeenLastCalledWith("label:nothingToUndo");
  });

  it("explains a conflict with a newer change", async () => {
    fetchMock.mockResolvedValue(json({ message: "A newer change touched these rows; undo it first", code: "undo.newer_change" }, 409));
    expect(await undoBatch("b1")).toBe(false);
    expect(toastMock).toHaveBeenLastCalledWith("error:undo.newer_change");
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("treats a code-less 409 from the undo route as a newer change", async () => {
    fetchMock.mockResolvedValue(json({ message: "A newer change touched these rows; undo it first" }, 409));
    await undoBatch("b1");
    expect(toastMock).toHaveBeenLastCalledWith("error:undo.newer_change");
  });

  it("runs undos one at a time", async () => {
    const order: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      order.push(`start ${String(input)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${String(input)}`);
      return json({});
    });
    await Promise.all([undoBatch("a"), undoBatch("b")]);
    expect(order).toEqual(["start /api/v2/mutations/a/undo", "end /api/v2/mutations/a/undo", "start /api/v2/mutations/b/undo", "end /api/v2/mutations/b/undo"]);
  });
});
