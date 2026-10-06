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

/** Input of createView: the API body (dataset defaults to ledger, the config to the dataset's defaults). */
export type CreateViewInput = z.input<typeof savedViewInputSchema>;

/**
 * Creates a view at the end of the list. Also the entry point for views
 * other services create, e.g. the import's "Importação · <arquivo>":
 * createView(userId, { name, isFavorite: false, config: { period: { preset: "all" },
 * filters: [{ field: "importId", op: "in", values: [importId] }] } }, db).
 */
export async function createView(userId: string, input: CreateViewInput, db: DbClient) {
  const parsed = savedViewInputSchema.parse(input);
  const last = await db.savedView.aggregate({ where: { userId }, _max: { position: true } });
  const view = await db.savedView.create({
    data: {
      userId,
      name: parsed.name,
      dataset: parsed.dataset,
      isFavorite: parsed.isFavorite,
      position: (last._max.position ?? 0) + 1,
      config: parsed.config as Prisma.InputJsonValue,
    },
  });
  return serializeView(view);
}

/**
 * Views auto-save: the UI PATCHes as the user edits. The config is checked
 * against the view's dataset. The built-in view keeps only display
 * preferences; its filters and search are always temporary.
 */
export async function updateView(userId: string, viewId: string, patch: SavedViewPatch, db: DbClient) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
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
  const updated = await db.savedView.update({
    where: { id: viewId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.isFavorite !== undefined && { isFavorite: patch.isFavorite }),
      ...(patch.position !== undefined && { position: patch.position }),
      ...(config && { config: config as Prisma.InputJsonValue }),
    },
  });
  return serializeView(updated);
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
  return createView(userId, { name, dataset, isFavorite: true, config } as CreateViewInput, db);
}

export async function deleteView(userId: string, viewId: string, db: DbClient) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
  if (!view) throw notFound("View", "view.not_found");
  if (view.isBuiltin) throw new LedgerError("The built-in view cannot be deleted", 422, { code: "view.builtin_delete" });
  await db.savedView.delete({ where: { id: viewId } });
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
