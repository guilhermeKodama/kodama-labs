import type { DbClient } from "@capital/server/lib/prisma";
import type { Prisma, SavedView } from "@/generated/prisma";
import { st } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import {
  BUILTIN_ALL_VIEW_KEY,
  BUILTIN_PERSISTED_CONFIG_KEYS,
  viewConfigSchema,
  type SavedViewInput,
  type SavedViewPatch,
  type ViewConfig,
} from "../contracts";
import { LedgerError, notFound } from "../lib/errors";

function parseConfig(raw: unknown): ViewConfig {
  const result = viewConfigSchema.safeParse(raw ?? {});
  return result.success ? result.data : viewConfigSchema.parse({});
}

export function serializeView(v: SavedView) {
  return {
    id: v.id,
    name: v.name,
    dataset: v.dataset,
    position: v.position,
    isBuiltin: v.isBuiltin,
    builtinKey: v.builtinKey,
    isFavorite: v.isFavorite,
    config: parseConfig(v.config),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** The built-in "Todas" view, created on first access. */
export async function ensureBuiltinViews(userId: string, db: DbClient) {
  await db.savedView.upsert({
    where: { userId_builtinKey: { userId, builtinKey: BUILTIN_ALL_VIEW_KEY } },
    create: {
      userId,
      dataset: "ledger",
      name: "Todas",
      position: 0,
      isBuiltin: true,
      builtinKey: BUILTIN_ALL_VIEW_KEY,
      isFavorite: true,
      config: {},
    },
    update: {},
  });
}

export async function listViews(userId: string, db: DbClient, dataset?: string) {
  await ensureBuiltinViews(userId, db);
  const views = await db.savedView.findMany({
    where: { userId, ...(dataset && { dataset }) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return views.map(serializeView);
}

export async function createView(userId: string, input: SavedViewInput, db: DbClient) {
  const last = await db.savedView.aggregate({ where: { userId }, _max: { position: true } });
  const view = await db.savedView.create({
    data: {
      userId,
      name: input.name,
      dataset: input.dataset,
      isFavorite: input.isFavorite,
      position: (last._max.position ?? 0) + 1,
      config: input.config as Prisma.InputJsonValue,
    },
  });
  return serializeView(view);
}

/**
 * Views auto-save: the UI PATCHes as the user edits. The built-in view keeps
 * only display preferences; its filters and search are always temporary.
 */
export async function updateView(userId: string, viewId: string, patch: SavedViewPatch, db: DbClient) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
  if (!view) throw notFound("View", "view.not_found");
  let config: ViewConfig | undefined = patch.config;
  if (view.isBuiltin) {
    if (patch.name !== undefined && patch.name !== view.name) throw new LedgerError("The built-in view cannot be renamed", 422, { code: "view.builtin_rename" });
    if (config) {
      const current = parseConfig(view.config);
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

export async function duplicateView(userId: string, viewId: string, db: DbClient, name?: string) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
  if (!view) throw notFound("View", "view.not_found");
  const copyName = name ?? `${view.name} ${st(await loadUserLocale(userId, db), "common.copySuffix")}`;
  return createView(userId, { name: copyName, dataset: view.dataset as SavedViewInput["dataset"], isFavorite: true, config: parseConfig(view.config) }, db);
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

/** Selection query of a saved view (period, filters, search). */
export async function viewSelection(userId: string, viewId: string, db: DbClient) {
  const view = await db.savedView.findFirst({ where: { id: viewId, userId } });
  if (!view) throw notFound("View", "view.not_found");
  const c = parseConfig(view.config);
  return { period: c.period, dateField: c.dateField, filters: c.filters, search: c.search, deleted: "exclude" as const };
}
