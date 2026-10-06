import type { Prisma } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { st, type Locale } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import type { HoldingsViewSeedKey, InvestmentOpsViewSeedKey, LedgerViewSeedKey } from "@capital/server/i18n/views";
import {
  holdingsViewConfigSchema,
  INCOME_OPERATION_TYPES,
  opsViewConfigSchema,
  viewConfigSchema,
  type HoldingsViewConfig,
  type LedgerFilter,
  type OpsViewConfig,
  type ViewConfig,
  type ViewDataset,
} from "../contracts";
import { inTransaction } from "./mutations";

/**
 * The default views every user starts with (mockup DEFAULT_VIEWS and the
 * saved list in canvas.data.json), seeded once per user.
 *
 * User.viewsSeedVersion records what was seeded, and each seeded row keeps
 * its SavedView.seedKey:
 * - version 1: every view that needs nothing of the user's data;
 * - version 2: the PJ views ("PJ", "Impostos PJ"), which filter by the
 *   user's business entities, so they wait for the first one (a new user
 *   only has PF).
 * A version is claimed with one conditional UPDATE inside the transaction
 * that inserts its views, so concurrent requests seed once, and a default
 * the user deleted never comes back.
 *
 * Runs at signup and lazily on GET /v2/views (users who predate it).
 */
export const VIEWS_SEED_VERSION = 2;

interface SeedContext {
  /** Every business entity, archived ones included ("PJ" = all businesses). */
  businessIds: string[];
  /** The system "taxes" category (Impostos), when the user has it. */
  taxesCategoryId: string | null;
}

type SeedOf<D extends ViewDataset, K extends string, C> = { dataset: D; seedKey: K; isFavorite: boolean; config: C };
export type ViewSeed =
  | SeedOf<"ledger", LedgerViewSeedKey, ViewConfig>
  | SeedOf<"holdings", HoldingsViewSeedKey, HoldingsViewConfig>
  | SeedOf<"investment_ops", InvestmentOpsViewSeedKey, OpsViewConfig>;

const outflows: LedgerFilter = { field: "flowKind", op: "in", values: ["out"] };
const ledger = (seedKey: LedgerViewSeedKey, isFavorite: boolean, config: Partial<ViewConfig>): ViewSeed => ({
  dataset: "ledger",
  seedKey,
  isFavorite,
  config: viewConfigSchema.parse(config),
});

/** Ledger defaults in the mockup's order; "PJ" carries no month in its name. */
export function ledgerSeeds(ctx: SeedContext): { seed: ViewSeed; needsBusiness: boolean }[] {
  const pj: LedgerFilter = { field: "entityId", op: "in", values: ctx.businessIds };
  const hasBusiness = ctx.businessIds.length > 0;
  const seeds: { seed: ViewSeed; needsBusiness: boolean }[] = [];
  const add = (seed: ViewSeed, needsBusiness = false) => seeds.push({ seed, needsBusiness });

  if (hasBusiness) add(ledger("pj", true, { filters: [pj], groupBy: [{ field: "entityId" }, { field: "categoryId" }] }), true);
  add(
    ledger("subs", true, {
      filters: [{ field: "isRecurring", op: "in", values: [true] }, outflows],
      groupBy: [{ field: "categoryId" }],
      columns: ["date", "description", "entityId", "accountId", "amountBase"],
      calcs: { amountBase: "sum", description: "count" },
    })
  );
  add(
    ledger("ir", true, {
      filters: [{ field: "isTaxDeductible", op: "in", values: [true] }],
      period: { preset: "ytd", offset: 0 },
      columns: ["date", "description", "categoryId", "accountId", "amountBase"],
    })
  );
  add(ledger("cat", true, { layout: "chart", chart: chart("bar"), filters: [outflows], groupBy: [{ field: "categoryId" }, { field: "entityId" }] }));
  add(ledger("pivot", false, { layout: "pivot", groupBy: [{ field: "categoryId" }, { field: "entityId" }] }));
  add(ledger("board", false, { layout: "board", groupBy: [{ field: "accountId" }], columns: ["description", "entityId", "categoryId", "amountBase"] }));
  add(ledger("cal", false, { layout: "calendar", filters: [outflows] }));
  add(
    ledger("trend", true, {
      layout: "chart",
      chart: chart("bar"),
      filters: [outflows],
      groupBy: [{ field: "date", bucket: "month" }, { field: "entityId" }],
      period: { preset: "last_3m", offset: 0 },
    })
  );
  add(ledger("flow", false, { layout: "chart", chart: chart("waterfall", { top: 8 }), groupBy: [{ field: "categoryId" }] }));
  add(
    ledger("balance", false, {
      layout: "chart",
      chart: chart("area", { cumulative: true }),
      filters: [outflows],
      groupBy: [{ field: "date", bucket: "day" }, { field: "entityId" }],
    })
  );
  if (hasBusiness && ctx.taxesCategoryId) {
    add(
      ledger("taxpj", false, {
        filters: [pj, { field: "categoryId", op: "in", values: [ctx.taxesCategoryId] }],
        period: { preset: "ytd", offset: 0 },
      }),
      true
    );
  }
  return seeds;
}

function chart(type: ViewConfig["chart"]["type"], extra: Partial<ViewConfig["chart"]> = {}): ViewConfig["chart"] {
  return { type, metric: "sum", cumulative: false, top: 0, ...extra };
}

/** Carteira tabs (Por classe, Por corretora, Por entidade, Lista) and the operations views (Proventos 12m, Operações). */
export function investmentSeeds(): ViewSeed[] {
  const holdings = (seedKey: HoldingsViewSeedKey, groupBy: HoldingsViewConfig["groupBy"]): ViewSeed => ({
    dataset: "holdings",
    seedKey,
    isFavorite: true,
    config: holdingsViewConfigSchema.parse({ groupBy }),
  });
  return [
    holdings("byClass", "allocationClass"),
    holdings("byBroker", "accountId"),
    holdings("byEntity", "entityId"),
    holdings("list", "none"),
    {
      dataset: "investment_ops",
      seedKey: "income12m",
      isFavorite: true,
      config: opsViewConfigSchema.parse({
        layout: "chart",
        period: { preset: "last_12m", offset: 0 },
        filters: [{ field: "type", op: "in", values: [...INCOME_OPERATION_TYPES] }],
        groupBy: "month",
        chart: { type: "bar" },
      }),
    },
    {
      dataset: "investment_ops",
      seedKey: "operations",
      isFavorite: true,
      config: opsViewConfigSchema.parse({ layout: "table", period: { preset: "all", offset: 0 } }),
    },
  ];
}

/** The view's name in the user's locale (views.<dataset>.<seedKey>). */
export function seedName(locale: Locale, seed: ViewSeed): string {
  switch (seed.dataset) {
    case "ledger":
      return st(locale, `views.ledger.${seed.seedKey}`);
    case "holdings":
      return st(locale, `views.holdings.${seed.seedKey}`);
    case "investment_ops":
      return st(locale, `views.investment_ops.${seed.seedKey}`);
  }
}

async function seedContext(userId: string, db: DbClient): Promise<SeedContext> {
  const [businesses, taxes] = await Promise.all([
    db.entity.findMany({ where: { userId, kind: "business" }, select: { id: true }, orderBy: { createdAt: "asc" } }),
    db.category.findFirst({ where: { userId, systemKey: "taxes" }, select: { id: true } }),
  ]);
  return { businessIds: businesses.map((b) => b.id), taxesCategoryId: taxes?.id ?? null };
}

/** Moves the user's seed version to `version`; true only for the one caller that did. */
async function claim(db: DbClient, userId: string, version: number): Promise<boolean> {
  const { count } = await db.user.updateMany({ where: { id: userId, viewsSeedVersion: { lt: version } }, data: { viewsSeedVersion: version } });
  return count === 1;
}

/** Moves a seeded ledger view right after the built-in one, keeping the others' order. */
async function placeAfterBuiltin(db: DbClient, userId: string, seedKey: string) {
  const views = await db.savedView.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, seedKey: true, isBuiltin: true, dataset: true, position: true },
  });
  const moved = views.find((v) => v.seedKey === seedKey && v.dataset === "ledger");
  const rest = views.filter((v) => v !== moved);
  const anchor = rest.findIndex((v) => v.isBuiltin && v.dataset === "ledger");
  if (!moved || anchor < 0) return;
  rest.splice(anchor + 1, 0, moved);
  for (const [position, view] of rest.entries()) {
    if (view.position !== position) await db.savedView.update({ where: { id: view.id }, data: { position } });
  }
}

/** Creates the default views the user has not had yet (see VIEWS_SEED_VERSION). Returns the seeded keys. */
export async function ensureDefaultViews(userId: string, db: DbClient): Promise<string[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { viewsSeedVersion: true } });
  if (!user || user.viewsSeedVersion >= VIEWS_SEED_VERSION) return [];
  if (user.viewsSeedVersion >= 1 && !(await db.entity.count({ where: { userId, kind: "business" } }))) return [];

  return inTransaction(db, async (tx) => {
    const ctx = await seedContext(userId, tx);
    const ledgerAll = ledgerSeeds(ctx);
    const seeds: ViewSeed[] = [];
    const base = await claim(tx, userId, 1);
    const business = ctx.businessIds.length > 0 && (await claim(tx, userId, 2));
    for (const { seed, needsBusiness } of ledgerAll) if (needsBusiness ? business : base) seeds.push(seed);
    if (base) seeds.push(...investmentSeeds());
    if (!seeds.length) return [];

    const locale = await loadUserLocale(userId, tx);
    const last = await tx.savedView.aggregate({ where: { userId }, _max: { position: true } });
    const start = (last._max.position ?? 0) + 1;
    await tx.savedView.createMany({
      data: seeds.map((seed, i) => ({
        userId,
        dataset: seed.dataset,
        name: seedName(locale, seed),
        seedKey: seed.seedKey,
        isFavorite: seed.isFavorite,
        position: start + i,
        config: seed.config as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    // "PJ" is the tab right after Todas (mockup DEFAULT_VIEWS), also when it arrives later with the first business.
    if (business && !base) await placeAfterBuiltin(tx, userId, "pj");
    return seeds.map((s) => s.seedKey);
  });
}
