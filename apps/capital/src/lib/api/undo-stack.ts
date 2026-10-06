/**
 * The ⌘Z stack: undoable change batches of this tab, newest last. Pure so
 * it can be tested; undo.ts owns the app's instance.
 */

export interface UndoEntry {
  batchId: string;
  /** What the toast said ("“iFood” excluída"); empty when the write had no toast. */
  message: string;
}

export interface UndoStack {
  push(entry: UndoEntry): void;
  /** Removes and returns the newest entry. */
  pop(): UndoEntry | undefined;
  peek(): UndoEntry | undefined;
  /** Drops a batch wherever it is (undone from its toast instead of ⌘Z). */
  remove(batchId: string): void;
  size(): number;
  clear(): void;
}

export function createUndoStack(limit = 50): UndoStack {
  let entries: UndoEntry[] = [];
  return {
    push(entry) {
      entries = [...entries.filter((item) => item.batchId !== entry.batchId), entry].slice(-limit);
    },
    pop() {
      const entry = entries.at(-1);
      entries = entries.slice(0, -1);
      return entry;
    },
    peek: () => entries.at(-1),
    remove(batchId) {
      entries = entries.filter((item) => item.batchId !== batchId);
    },
    size: () => entries.length,
    clear() {
      entries = [];
    },
  };
}

/** The `batchId` of a write response (`{ batchId, ... }`), if it recorded one. */
export function readBatchId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const batchId = (data as { batchId?: unknown }).batchId;
  return typeof batchId === "string" && batchId ? batchId : null;
}

/**
 * Picks the batch for ⌘Z when this tab has none: the newest batch from
 * GET /v2/mutations?undoable=true&limit=1 that is not undone yet. Accepts
 * the bare array the route returns today and `{ batches }`.
 */
export function latestUndoable(data: unknown): string | null {
  const list = Array.isArray(data) ? data : typeof data === "object" && data !== null ? (data as { batches?: unknown }).batches : null;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { id, undoneAt } = item as { id?: unknown; undoneAt?: unknown };
    if (typeof id === "string" && !undoneAt) return id;
  }
  return null;
}
