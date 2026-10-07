import type { DbClient } from "@capital/server/lib/prisma";
import type { Prisma, SavedView } from "@/generated/prisma";
import { st } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import type { z } from "zod";
import {
  BUILTIN_ALL_VIEW_KEY,
  BUILTIN_PERSISTED_CONFIG_KEYS,
  savedViewInputSchema,
  VIEW_CONFIG_SCHEMAS,
  VIEW_DATASETS,
  viewConfigSchema,
  type AnyViewConfig,
  type DuplicateViewInput,
  type HoldingsViewConfig,
  type OpsViewConfig,
  type SavedViewPatch,
  type ViewConfig,
  type ViewDataset,
} from "../contracts";
import { LedgerError, notFound } from "../lib/errors";
import { ensureDefaultViews } from "./default-views";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "./mutations";

const datasetOf = (value: string): ViewDataset => ((VIEW_DATASETS as readonly string[]).includes(value) ? (value as ViewDataset) : "ledger");

/** A stored config read with its dataset's schema; an unreadable one falls back to the defaults. */
function parseConfig(dataset: ViewDataset, raw: unknown): AnyViewConfig {
  const schema = VIEW_CONFIG_SCHEMAS[dataset];
  const result = schema.safeParse(raw ?? {});
  return result.success ? result.data : schema.parse({});
}

/** A config sent by the client, validated with its dataset's schema (a ZodError is a 422). */
function validateConfig(dataset: ViewDataset, raw: unknown): AnyViewConfig {
  return VIEW_CONFIG_SCHEMAS[dataset].parse(raw ?? {});
}

interface SerializedViewBase {
  id: string;
  name: string;
  position: number;
  isBuiltin: boolean;
  builtinKey: string | null;
  /** Key of the default view this one was seeded from (default-views.ts), e.g. "ir"; the client resolves ?view=seed:<key> with it. */
  seedKey: string | null;
  isFavorite: boolean;
  updatedAt: string;
}

/** A view as the API returns it; `config` follows `dataset`. */
export type SerializedView = SerializedViewBase &
  ({ dataset: "ledger"; config: ViewConfig } | { dataset: "holdings"; config: HoldingsViewConfig } | { dataset: "investment_ops"; config: OpsViewConfig });

export function serializeView(v: SavedView): SerializedView {
  const dataset = datasetOf(v.dataset);
  return {
    id: v.id,
    name: v.name,
    dataset,
    position: v.position,
    isBuiltin: v.isBuiltin,
    builtinKey: v.builtinKey,
    seedKey: v.seedKey,
    isFavorite: v.isFavorite,
    config: parseConfig(dataset, v.config),
    updatedAt: v.updatedAt.toISOString(),
  } as SerializedView;
}

/** The built-in "Todas" view, created on first access and named in the user's locale. */
export async function ensureBuiltinViews(userId: string, db: DbClient) {
  const where = { userId_builtinKey: { userId, builtinKey: BUILTIN_ALL_VIEW_KEY } };
  if (await db.savedView.findUnique({ where, select: { id: true } })) return;
  await db.savedView.upsert({
    where,
    create: {
      userId,
      dataset: "ledger",
      name: st(await loadUserLocale(userId, db), "views.builtin.all"),
      position: 0,
      isBuiltin: true,
      builtinKey: BUILTIN_ALL_VIEW_KEY,
      isFavorite: true,
      config: {},
    },
    update: {},
  });
}

/** The user's views (one dataset, or all), creating "Todas" and the default views on first access. */
export async function listViews(userId: string, db: DbClient, dataset?: string) {
  await ensureBuiltinViews(userId, db);
  await ensureDefaultViews(userId, db);
  const views = await db.savedView.findMany({
    where: { userId, ...(dataset && { dataset }) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return views.map(serializeView);
}

/** Input of createView: the API body (dataset defaults to ledger, the config to the dataset's defaults, the name to "Nova view N"). */
export type CreateViewInput = z.input<typeof savedViewInputSchema>;

/** A view write: the view, and the undo batch it recorded (null when nothing was recorded, see updateView). */
export type ViewWriteResult = SerializedView & { batchId: string | null };

export interface ViewWriteOptions {
  /** Add the records to the caller's batch instead of recording one (the import's view goes in the import's batch). */
  collect?: MutationRecordInput[];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The name of a view created without one: `base` ("Nova view") when no
 * view of the dataset is called that yet, else `base N` with N one past
 * the highest number in use ("Nova view" counts as 1), as Notion does.
 */
export function nextNewViewName(base: string, taken: readonly string[]): string {
  const pattern = new RegExp(`^${escapeRegExp(base)}(?: (\\d+))?$`);
  let highest = 0;
  for (const name of taken) {
    const match = pattern.exec(name.trim());
    if (match) highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
  }
  return highest ? `${base} ${highest + 1}` : base;
}

/**
 * Creates a view at the end of the list, in one undoable batch (undo
 * removes it). Also the entry point for views other services create, e.g.
 * the import's "Importação · <arquivo>", which joins the import's batch
 * through `collect`: createView(userId, { name, isFavorite: false, config:
 * { period: { preset: "all" }, filters: [{ field: "importId", op: "in",
 * values: [importId] }] } }, tx, { collect: records }).
 *
 * Without a name (the "+" of the tabs, "+ Nova view" and ⌘K) the view is
 * named "Nova view", "Nova view 2", … in the user's locale (nextNewViewName,
 * per dataset) and its creation is not recorded (batchId null), like the
 * config edits that follow it: ⌘Z after setting up a new view's filters
 * must not delete the view. "Excluir view" (undoable) removes it.
 */
export async function createView(userId: string, input: CreateViewInput, db: DbClient, opts: ViewWriteOptions & { op?: string } = {}): Promise<ViewWriteResult> {
  const parsed = savedViewInputSchema.parse(input);
  const named = parsed.name !== undefined;
  const base = named ? null : st(await loadUserLocale(userId, db), "views.newView");
  return inTransaction(db, async (tx) => {
    let name = parsed.name;
    if (name === undefined) {
      const taken = await tx.savedView.findMany({ where: { userId, dataset: parsed.dataset, name: { startsWith: base! } }, select: { name: true } });
      name = nextNewViewName(base!, taken.map((view) => view.name));
    }
    const last = await tx.savedView.aggregate({ where: { userId }, _max: { position: true } });
    const view = await tx.savedView.create({
      data: {
        userId,
        name,
        dataset: parsed.dataset,
        isFavorite: parsed.isFavorite,
        position: (last._max.position ?? 0) + 1,
        config: parsed.config as Prisma.InputJsonValue,
      },
    });
    const record: MutationRecordInput = { model: "SavedView", recordId: view.id, before: null, after: snapshot(view) };
    if (opts.collect) {
      opts.collect.push(record);
      return { ...serializeView(view), batchId: null };
    }
    if (!named) return { ...serializeView(view), batchId: null };
    const batchId = await recordMutation(tx, userId, opts.op ?? "view.create", view.name, [record]);
    return { ...serializeView(view), batchId };
  });
}

/** Renames typed in a row (the name field auto-saves as the user types) within this window are one undo step. */
const RENAME_COALESCE_MS = 2 * 60_000;

/**
 * Records a view's rename or favorite toggle. A rename right after a
 * rename of the same view, with nothing else recorded in between, extends
 * that batch (its `after`) instead of adding one, so ⌘Z undoes the whole
 * name typed, not one debounced chunk of it.
 */
async function recordViewChange(tx: DbClient, userId: string, before: SavedView, after: SavedView, renameOnly: boolean): Promise<string> {
  const op = renameOnly ? "view.rename" : "view.update";
  if (renameOnly) {
    const last = await tx.mutationBatch.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, include: { records: true } });
    const record = last?.records.length === 1 ? last.records[0] : null;
    if (
      last &&
      record &&
      last.op === op &&
      !last.undoneAt &&
      record.model === "SavedView" &&
      record.recordId === after.id &&
      Date.now() - last.createdAt.getTime() < RENAME_COALESCE_MS
    ) {
      await tx.mutationRecord.update({ where: { id: record.id }, data: { after: snapshot(after) as Prisma.InputJsonValue } });
      await tx.mutationBatch.update({ where: { id: last.id }, data: { summary: after.name } });
      return last.id;
    }
  }
  return recordMutation(tx, userId, op, after.name, [{ model: "SavedView", recordId: after.id, before: snapshot(before), after: snapshot(after) }]);
}

/**
 * Views auto-save: the UI PATCHes as the user edits. The config is checked
 * against the view's dataset. The built-in view keeps only display
 * preferences; its filters and search are always temporary.
 *
 * Undo log: a rename or a favorite toggle is recorded (one batch, see
 * recordViewChange); config and position edits are not. They are
 * auto-saved continuously, so recording them would put every filter click
 * on the ⌘Z stack, and (as later changes to the same row) would also block
 * undoing the view's creation or rename with "undo.newer_change". Undoing
 * a rename therefore writes back only the name, and the config stays as
 * last edited. `batchId` is null when nothing was recorded.
 */
export async function updateView(userId: string, viewId: string, patch: SavedViewPatch, db: DbClient): Promise<ViewWriteResult> {
  return inTransaction(db, async (tx) => {
    const view = await tx.savedView.findFirst({ where: { id: viewId, userId } });
    if (!view) throw notFound("View", "view.not_found");
    const dataset = datasetOf(view.dataset);
    let config: AnyViewConfig | undefined = patch.config ? validateConfig(dataset, patch.config) : undefined;
    if (view.isBuiltin) {
      if (patch.name !== undefined && patch.name !== view.name) throw new LedgerError("The built-in view cannot be renamed", 422, { code: "view.builtin_rename" });
      if (config) {
        const current = parseConfig(dataset, view.config) as ViewConfig;
        const kept = { ...current } as Record<string, unknown>;
        for (const key of BUILTIN_PERSISTED_CONFIG_KEYS) kept[key] = (config as Record<string, unknown>)[key];
        config = viewConfigSchema.parse({ ...kept, filters: [], search: undefined });
      }
    }
    const updated = await tx.savedView.update({
      where: { id: viewId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.isFavorite !== undefined && { isFavorite: patch.isFavorite }),
        ...(patch.position !== undefined && { position: patch.position }),
        ...(config && { config: config as Prisma.InputJsonValue }),
      },
    });
    const renamed = updated.name !== view.name;
    const favorited = updated.isFavorite !== view.isFavorite;
    const batchId = renamed || favorited ? await recordViewChange(tx, userId, view, updated, renamed && !favorited) : null;
    return { ...serializeView(updated), batchId };
  });
}

/**
 * "Duplicar" and "Salvar como nova": a new favorite view of the same
 * dataset. `config`, the one on screen (temporary filters of "Todas" or of
 * a drill included), replaces the stored one; the name defaults to
 * "<name> (cópia)" in the user's locale.
 */
export async function duplicateView(userId: string, viewId: string, db: DbClient, input: DuplicateViewInput = {}) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
  if (!view) throw notFound("View", "view.not_found");
  const dataset = datasetOf(view.dataset);
  const config = input.config ? validateConfig(dataset, input.config) : parseConfig(dataset, view.config);
  const name = input.name ?? `${view.name} ${st(await loadUserLocale(userId, db), "common.copySuffix")}`;
  return createView(userId, { name, dataset, isFavorite: true, config } as CreateViewInput, db, { op: "view.duplicate" });
}

/**
 * Deletes a view outright, in one undoable batch: undo re-creates it from
 * its snapshot under the same id (and seed key), so links to it work again.
 * With `collect` the record joins the caller's batch (an import revert).
 */
export async function deleteView(userId: string, viewId: string, db: DbClient, opts: ViewWriteOptions = {}): Promise<{ batchId: string | null }> {
  return inTransaction(db, async (tx) => {
    const view = await tx.savedView.findFirst({ where: { id: viewId, userId } });
    if (!view) throw notFound("View", "view.not_found");
    if (view.isBuiltin) throw new LedgerError("The built-in view cannot be deleted", 422, { code: "view.builtin_delete" });
    await tx.savedView.delete({ where: { id: viewId } });
    const record: MutationRecordInput = { model: "SavedView", recordId: view.id, before: snapshot(view), after: null };
    if (opts.collect) {
      opts.collect.push(record);
      return { batchId: null };
    }
    return { batchId: await recordMutation(tx, userId, "view.delete", view.name, [record]) };
  });
}

export async function reorderViews(userId: string, orderedIds: string[], db: DbClient) {
  const owned = await db.savedView.findMany({ where: { userId, id: { in: orderedIds } }, select: { id: true } });
  if (owned.length !== orderedIds.length) throw notFound("View", "view.not_found");
  await Promise.all(orderedIds.map((id, position) => db.savedView.update({ where: { id }, data: { position } })));
  return listViews(userId, db);
}

/** Selection query of a saved ledger view (period, filters, search). */
export async function viewSelection(userId: string, viewId: string, db: DbClient) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
  if (!view) throw notFound("View", "view.not_found");
  if (datasetOf(view.dataset) !== "ledger") throw new LedgerError("Only transaction views can be exported", 422, { code: "view.not_exportable" });
  const c = parseConfig("ledger", view.config) as ViewConfig;
  return { period: c.period, dateField: c.dateField, filters: c.filters, search: c.search, deleted: "exclude" as const };
}
