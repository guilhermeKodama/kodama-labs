import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiGet, apiPost } from "./client";
import { invalidateEvent } from "./invalidation";
import { createUndoStack, latestUndoable } from "./undo-stack";

/**
 * App-wide undo. Every write that records a change batch can be undone:
 * pushUndo shows the mockup's pill ("“iFood” excluída · Desfazer") and
 * keeps the batch on this tab's ⌘Z stack. Undoing calls
 * POST /v2/mutations/{id}/undo and refreshes everything ledger-derived.
 *
 * Module state rather than context so mutation callbacks can call it;
 * <UndoBridge> (undo-bridge.tsx, in the app layout) supplies the query
 * client and the translations, and binds ⌘Z.
 */

export interface UndoDeps {
  queryClient: QueryClient;
  /** Strings of the "common" namespace. */
  label: (key: "undo" | "undone" | "nothingToUndo") => string;
  /** Localized text for a failed request (errors.ts). */
  errorText: (error: unknown) => string;
}

// Used only if a toast fires before <UndoBridge> mounted; pt-BR is the default locale.
const FALLBACK = { undo: "Desfazer", undone: "Desfeito", nothingToUndo: "Nada para desfazer", failed: "Não foi possível desfazer." };

let deps: UndoDeps | null = null;
export const undoStack = createUndoStack();
// Undos run one at a time: two quick ⌘Z must not race on the same rows.
let queue: Promise<unknown> = Promise.resolve();

export function configureUndo(next: UndoDeps | null): void {
  deps = next;
}

const toastId = (batchId: string) => `undo:${batchId}`;
const label = (key: "undo" | "undone" | "nothingToUndo") => deps?.label(key) ?? FALLBACK[key];
const errorText = (error: unknown) => deps?.errorText(error) ?? FALLBACK.failed;

export interface PushUndoOptions {
  /**
   * Runs before the batch is undone from the pill (e.g. removing receipts
   * uploaded after the write, which the batch did not record).
   */
  beforeUndo?: () => Promise<unknown>;
  /** false keeps the batch off the ⌘Z stack (only the pill can undo it, e.g. because of beforeUndo). */
  stack?: boolean;
}

/** Shows the undo pill for a batch and puts it on the ⌘Z stack. */
export function pushUndo(batchId: string, message: string, { beforeUndo, stack = true }: PushUndoOptions = {}): void {
  if (stack) undoStack.push({ batchId, message });
  toast(message, {
    id: toastId(batchId),
    duration: 6000,
    action: {
      label: label("undo"),
      onClick: () => void (beforeUndo ? beforeUndo().catch(() => undefined) : Promise.resolve()).then(() => undoBatch(batchId)),
    },
  });
}

/** Puts a batch on the ⌘Z stack without a toast (writes the UI does not announce). */
export function rememberUndo(batchId: string, message = ""): void {
  undoStack.push({ batchId, message });
}

/**
 * After a successful write (useAppMutation): the undo pill when the server
 * recorded a batch, the batch alone on the ⌘Z stack when there is no
 * message, and a plain toast when nothing was recorded (e.g. 0 rows changed).
 */
export function announceWrite(batchId: string | null, message: string | null | undefined): void {
  if (batchId && message) pushUndo(batchId, message);
  else if (batchId) rememberUndo(batchId);
  else if (message) toast(message);
}

/**
 * Before the server sent error codes, a 409 from the undo route meant a
 * newer change touched the same rows; give it that code so the message is
 * the specific one.
 */
function undoError(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409 && !error.code) {
    return new ApiError({ status: 409, message: error.message, code: "undo.newer_change" });
  }
  return error;
}

async function runUndo(batchId: string, announce: boolean): Promise<boolean> {
  try {
    await apiPost(`/api/v2/mutations/${encodeURIComponent(batchId)}/undo`);
  } catch (error) {
    toast(errorText(undoError(error)));
    return false;
  }
  if (deps) void invalidateEvent(deps.queryClient, "undo");
  if (announce) toast(label("undone"));
  return true;
}

/**
 * Undoes one batch and closes its toast. `announce` confirms with a
 * "Desfeito" pill (for ⌘Z, where no pill was clicked).
 */
export function undoBatch(batchId: string, { announce = false }: { announce?: boolean } = {}): Promise<boolean> {
  undoStack.remove(batchId);
  toast.dismiss(toastId(batchId));
  const run = queue.then(() => runUndo(batchId, announce));
  queue = run.catch(() => undefined);
  return run;
}

/**
 * ⌘Z: the newest batch of this tab, or, when the tab has none (after a
 * reload), the newest undoable batch the server knows.
 */
export async function undoLast(): Promise<boolean> {
  const entry = undoStack.pop();
  if (entry) return undoBatch(entry.batchId, { announce: true });
  let batchId: string | null;
  try {
    batchId = latestUndoable(await apiGet<unknown>("/api/v2/mutations", { undoable: true, limit: 1 }));
  } catch (error) {
    toast(errorText(error));
    return false;
  }
  if (!batchId) {
    toast(label("nothingToUndo"));
    return false;
  }
  return undoBatch(batchId, { announce: true });
}
