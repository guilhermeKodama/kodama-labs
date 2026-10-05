import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import { encodeCreateParam, type QuickAddDraft } from "./quick-add";

/**
 * The draft of a view: changes on screen that are never saved, kept in
 * the `draft` URL param of /transactions. Temporary filters on "Todas"
 * (which saves only display preferences), and every drill (a pivot cell,
 * a total, a chart bar). It is a patch over the saved config, as
 * base64url JSON, and it drives the yellow "unsaved" dot plus "Limpar /
 * Salvar como nova".
 *
 * OWNER: S1 (views). The codec, isDirty and the hrefs are done; S1 adds
 * what produces drafts (drill.ts) and the UI around them.
 */

/** The ViewConfig keys a draft may change. */
export const VIEW_CONFIG_KEYS = [
  "layout",
  "period",
  "dateField",
  "filters",
  "search",
  "groupBy",
  "sort",
  "columns",
  "calcs",
  "chart",
  "transferDisplay",
] as const satisfies readonly (keyof ViewConfig)[];

export type ViewDraft = Partial<ViewConfig> & {
  /** What the drill came from ("Saídas · set/2026"), for the banner; not part of the config. */
  label?: string;
};

type ConfigKey = (typeof VIEW_CONFIG_KEYS)[number];

/** Rough shape of each key: enough to drop junk from a hand-edited URL (the API validates the rest). */
const SHAPE: Record<ConfigKey, "string" | "object" | "array"> = {
  layout: "string",
  period: "object",
  dateField: "string",
  filters: "array",
  search: "string",
  groupBy: "array",
  sort: "array",
  columns: "array",
  calcs: "object",
  chart: "object",
  transferDisplay: "string",
};

function shapeOf(value: unknown): "string" | "object" | "array" | "other" {
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null) return "object";
  return "other";
}

/** Known keys with the right shape, undefined values dropped. */
export function cleanViewDraft(value: unknown): ViewDraft {
  if (shapeOf(value) !== "object") return {};
  const raw = value as Record<string, unknown>;
  const draft: Record<string, unknown> = {};
  for (const key of VIEW_CONFIG_KEYS) {
    if (raw[key] !== undefined && shapeOf(raw[key]) === SHAPE[key]) draft[key] = raw[key];
  }
  if (typeof raw.label === "string" && raw.label) draft.label = raw.label;
  return draft as ViewDraft;
}

/** The config part of a draft (the label left out). */
function patchOf(draft: ViewDraft | null | undefined): Partial<ViewConfig> {
  if (!draft) return {};
  const { label, ...patch } = cleanViewDraft(draft);
  void label;
  return patch;
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** The `draft` param for a draft; null when there is nothing to keep (drop the param). */
export function encodeViewDraft(draft: ViewDraft | null | undefined): string | null {
  const clean = cleanViewDraft(draft);
  return Object.keys(clean).length ? toBase64Url(JSON.stringify(clean)) : null;
}

/** The draft in a `draft` param; null when absent or unreadable. */
export function decodeViewDraft(param: string | null | undefined): ViewDraft | null {
  if (!param) return null;
  try {
    const draft = cleanViewDraft(JSON.parse(fromBase64Url(param)));
    return Object.keys(draft).length ? draft : null;
  } catch {
    return null;
  }
}

/** Structural equality of JSON values (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return left.length === right.length && left.every(([key, value]) => sameValue(value, (b as Record<string, unknown>)[key]));
}

/** The config on screen: the saved one with the draft on top. */
export function applyViewDraft(config: ViewConfig, draft: ViewDraft | null | undefined): ViewConfig {
  return { ...config, ...patchOf(draft) };
}

/** Whether the draft changes anything in the saved config (the yellow dot). */
export function isDirty(config: ViewConfig, draft: ViewDraft | null | undefined): boolean {
  return Object.entries(patchOf(draft)).some(([key, value]) => !sameValue(config[key as ConfigKey], value));
}

/** The smallest draft that turns `saved` into `next`. */
export function diffViewConfig(saved: ViewConfig, next: ViewConfig): ViewDraft {
  const draft: Record<string, unknown> = {};
  for (const key of VIEW_CONFIG_KEYS) {
    if (!sameValue(saved[key], next[key])) draft[key] = next[key];
  }
  return draft as ViewDraft;
}

/** Body of POST /v2/views for "Salvar como nova": the saved config with the draft applied. */
export function saveAsNewView(saved: ViewConfig, draft: ViewDraft | null | undefined, name: string) {
  return { name, dataset: "ledger" as const, isFavorite: true, config: applyViewDraft(saved, draft) };
}

// ---------------------------------------------------------------------------
// The `view` param and links into /transactions
// ---------------------------------------------------------------------------

/** `view=seed:<key>` names a seeded view by its key (old /tax → seed:ir); the screen resolves it to the user's view id. */
export const SEED_VIEW_PREFIX = "seed:";

export function parseViewParam(value: string | null | undefined): { viewId: string } | { seedKey: string } | null {
  if (!value) return null;
  if (value.startsWith(SEED_VIEW_PREFIX)) {
    const seedKey = value.slice(SEED_VIEW_PREFIX.length);
    return seedKey ? { seedKey } : null;
  }
  return { viewId: value };
}

export interface TransactionsHrefOptions {
  /** A saved view by id… */
  viewId?: string | null;
  /** …or a seeded one by key ("ir", "subs", "pj"). */
  seedKey?: string | null;
  draft?: ViewDraft | null;
  /** Search typed in the view (transient). */
  q?: string | null;
  /** Opens the detail sheet of this entry. */
  entry?: string | null;
  /** Opens "Nova transação", prefilled with this draft ({} for a blank form). */
  create?: QuickAddDraft | null;
  /** Opens Exibição (a new view starts there). */
  display?: boolean;
  /** Opens "Importar extrato". */
  import?: boolean;
  /** Opens the trash. */
  trash?: boolean;
}

/** A link into /transactions (views, ⌘K results, the sidebar, notifications). */
export function buildTransactionsHref(options: TransactionsHrefOptions = {}): string {
  const params = new URLSearchParams();
  const view = options.viewId ?? (options.seedKey ? `${SEED_VIEW_PREFIX}${options.seedKey}` : null);
  if (view) params.set("view", view);
  const draft = encodeViewDraft(options.draft);
  if (draft) params.set("draft", draft);
  if (options.q) params.set("q", options.q);
  if (options.entry) params.set("entry", options.entry);
  if (options.create) params.set("create", encodeCreateParam(options.create));
  if (options.display) params.set("display", "1");
  if (options.import) params.set("import", "1");
  if (options.trash) params.set("trash", "1");
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}
