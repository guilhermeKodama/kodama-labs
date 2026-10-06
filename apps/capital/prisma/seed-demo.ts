/**
 * Demo user with the dataset of the new-UI mockup (capital-nova-ui-mockups):
 * PF, Kodama LTDA and Kodama LLC with their banks, cards and brokers, the
 * mockup's transactions with the current month playing its September,
 * recurring rules, budgets, categorization rules, a year of aportes and
 * proventos, positions close to its Carteira, allocation targets and the
 * FIRE goal.
 *
 * Everything is written through the app's services (entries, transfers,
 * installments, recurring rules, budgets, rules, investment operations), so
 * statements, base amounts, rule hits and undo batches come out as the app
 * would make them. The batches are recorded with source "system", so the
 * demo user's ⌘Z never undoes the seed.
 *
 * Idempotent: an existing demo user is deleted (cascade) and rebuilt.
 *
 *   pnpm --filter @wallex/capital db:seed:demo               # current month = the mockup's September
 *   pnpm --filter @wallex/capital db:seed:demo -- --month=2026-09
 *   pnpm --filter @wallex/capital db:seed:demo -- --dry-run  # print the plan, write nothing
 *
 * Login: DEMO_USER_EMAIL / DEMO_USER_PASSWORD (.env.example), defaulting to
 * the values below. Development databases only (*_dev / *_test).
 */
import path from "node:path";
import { PrismaClient, type Account } from "../src/generated/prisma";
import { parseLocalDate, formatDateOnly } from "../src/server/lib/date-utils";
import { assertNonProductionDatabase } from "../src/server/lib/db-guard";
import { st } from "../src/server/i18n";
import { signup } from "../src/server/modules/auth/services/signup";
import { createBudget } from "../src/server/modules/budgets/services/budget-crud";
import { monthOverview } from "../src/server/modules/budgets/services/budget-overview";
import { getSystemCategory } from "../src/server/modules/categories/lib/system-categories";
import { createCategory, updateCategory } from "../src/server/modules/categories/services/categories";
import { upsertFireGoal } from "../src/server/modules/fire/services/upsert-fire-goal";
import { FireGoalInputSchema } from "../src/server/modules/fire/validations/fire";
import {
  createHolding,
  portfolioSummary,
  recordOperation,
  setTargets,
  updateHolding,
  type OperationInput,
} from "../src/server/modules/investments/services/portfolio";
import { loadFx } from "../src/server/modules/ledger/lib/fx";
import { accountBalances, createAccount, updateAccount } from "../src/server/modules/ledger/services/accounts";
import { createEntity, getDefaultAccount, getPersonalEntity, updateEntity } from "../src/server/modules/ledger/services/entities";
import { createEntry, updateEntry } from "../src/server/modules/ledger/services/entries";
import { withMutationSource } from "../src/server/modules/ledger/services/mutations";
import { createRule } from "../src/server/modules/ledger/services/rules";
import { markStatementPayment } from "../src/server/modules/ledger/services/statements";
import { createRecurringRule, processDueRules, type RecurringRuleInput } from "../src/server/modules/recurring/services/recurring-rules";
import {
  addMonths,
  ANCHOR_DAY,
  DEMO_ACCOUNTS,
  DEMO_CATEGORIES,
  DEMO_ENTITIES,
  DEMO_RECURRING,
  DEMO_RULES,
  FIRE_GOAL,
  isoDate,
  LLC_DISTRIBUTION,
  MOCK_ENTRIES,
  MOCK_MONTHS,
  monthIndex,
  MONTHLY_BUDGETS,
  NOTEBOOK,
  planInvestments,
  PROFIT_DISTRIBUTION,
  round,
  scaledAmount,
  TARGETS,
  YEARLY_BUDGETS,
  YEARLY_HISTORY,
  type AccountKey,
  type CategoryKey,
  type EntityKey,
  type HoldingKey,
  type InvestmentPlan,
  type PlannedIncome,
  type YearMonth,
} from "../scripts/seed-demo-data";

// Development-only credentials; .env.example documents the overrides.
const DEFAULT_DEMO_EMAIL = "demo@capital.test";
const DEFAULT_DEMO_PASSWORD = "capital-demo-2026";
const DEMO_NAME = "Guilherme";
/** The seed deletes the user it targets, so it only ever targets the reserved .test domain. */
const DEMO_EMAIL_DOMAIN = "@capital.test";
const TIMEZONE = "America/Sao_Paulo";

type Db = PrismaClient;

interface Ctx {
  db: Db;
  userId: string;
  m0: YearMonth;
  date: (k: number, day: number) => string;
  entities: Record<EntityKey, string>;
  accounts: Record<AccountKey, Account>;
  categories: Record<CategoryKey, string>;
}

const counts = { entries: 0, transfers: 0, operations: 0, bills: 0 };

function log(message: string) {
  console.log(`[seed-demo] ${message}`);
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const monthArg = argv.find((a) => a.startsWith("--month="))?.slice("--month=".length);
  let month: YearMonth | null = null;
  if (monthArg) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthArg);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`--month must be YYYY-MM, got "${monthArg}"`);
    month = { year: Number(match[1]), month: Number(match[2]) };
  }
  return { dryRun, month };
}

function currentMonth(): YearMonth {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  return { year, month };
}

const label = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// User, entities, accounts, categories, rules
// ---------------------------------------------------------------------------

async function seedEntities(db: Db, userId: string): Promise<Record<EntityKey, string>> {
  const pf = await getPersonalEntity(userId, db);
  await updateEntity(userId, pf.id, { description: DEMO_ENTITIES.pf.description, color: DEMO_ENTITIES.pf.color }, db);
  const business = async (key: "ltda" | "llc") => {
    const e = DEMO_ENTITIES[key];
    const entity = await createEntity(userId, { kind: "business", name: e.name, description: e.description, defaultCurrency: e.currency, taxRate: e.taxRate, color: e.color }, db);
    return entity.id;
  };
  return { pf: pf.id, ltda: await business("ltda"), llc: await business("llc") };
}

async function seedAccounts(db: Db, userId: string, entities: Record<EntityKey, string>): Promise<Record<AccountKey, Account>> {
  const accounts = {} as Record<AccountKey, Account>;
  for (const [key, spec] of Object.entries(DEMO_ACCOUNTS) as [AccountKey, (typeof DEMO_ACCOUNTS)[AccountKey]][]) {
    const entityId = entities[spec.entity];
    if (spec.isDefault) {
      const entity = await db.entity.findUniqueOrThrow({ where: { id: entityId } });
      const main = await getDefaultAccount(entity, db);
      await updateAccount(userId, main.id, { name: spec.name, institution: spec.institution }, db);
      accounts[key] = await db.account.findUniqueOrThrow({ where: { id: main.id } });
    } else {
      accounts[key] = await createAccount(
        userId,
        {
          entityId,
          type: spec.type,
          name: spec.name,
          institution: spec.institution,
          currency: spec.currency,
          ...(spec.card && {
            creditLimit: spec.card.creditLimit,
            closingDay: spec.card.closingDay,
            dueDay: spec.card.dueDay,
            payFromAccountId: accounts[spec.card.payFrom].id,
          }),
        },
        db
      );
    }
  }
  return accounts;
}

async function seedCategories(db: Db, userId: string): Promise<Record<CategoryKey, string>> {
  const ids = {} as Record<CategoryKey, string>;
  for (const [key, spec] of Object.entries(DEMO_CATEGORIES) as [CategoryKey, (typeof DEMO_CATEGORIES)[CategoryKey]][]) {
    if (spec.systemKey) {
      const category = await getSystemCategory(userId, spec.systemKey, db);
      if (category.color !== spec.color) await updateCategory(userId, category.id, { color: spec.color }, db);
      ids[key] = category.id;
    } else {
      ids[key] = (await createCategory(userId, { name: spec.name!, type: spec.type!, color: spec.color }, db)).id;
    }
  }
  for (const rule of DEMO_RULES) {
    await createRule(userId, { matchType: "contains", pattern: rule.pattern, categoryId: ids[rule.category] }, db);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

async function seedBudgets(ctx: Ctx) {
  const { db, userId, m0 } = ctx;
  // Monthly budgets run from January of the mockup's July (M-2), so the year's heatmap has its budget line.
  const monthlyFrom = `${addMonths(m0, -2).year}-01`;
  for (const b of MONTHLY_BUDGETS) {
    await createBudget(userId, { entityId: b.entity ? ctx.entities[b.entity] : null, categoryId: ctx.categories[b.category], amount: b.amount, period: "monthly", effectiveFrom: monthlyFrom }, db);
  }
  for (const b of YEARLY_BUDGETS) {
    const input: Parameters<typeof createBudget>[1] & { notes?: string } = {
      entityId: ctx.entities[b.entity],
      categoryId: ctx.categories[b.category],
      amount: b.amount,
      period: "yearly",
      effectiveFrom: `${m0.year}-01`,
      notes: b.notes,
    };
    const budget = await createBudget(userId, input, db);
    // Budget.notes exists in the schema; until the budget service takes notes, the seed sets them on the row it just created.
    if (budget.notes !== b.notes) await db.budget.update({ where: { id: budget.id }, data: { notes: b.notes } });
  }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

async function seedRecurring(ctx: Ctx) {
  const { db, userId } = ctx;
  const deductibleRuleIds: string[] = [];
  for (const r of DEMO_RECURRING) {
    const input: RecurringRuleInput & { isTaxDeductible?: boolean } = {
      kind: r.kind,
      accountId: ctx.accounts[r.account].id,
      ...(r.toAccount && { toAccountId: ctx.accounts[r.toAccount].id, transferDirection: "investment_deposit" as const }),
      amount: r.amount,
      description: r.description,
      categoryId: r.category ? ctx.categories[r.category] : null,
      frequency: "monthly",
      startDate: ctx.date(r.startK, r.day),
      ...(r.deductible && { isTaxDeductible: true }),
    };
    const rule = await createRecurringRule(userId, input, db);
    if (r.deductible) deductibleRuleIds.push(rule.id);
  }
  // Book every occurrence up to the mockup's "today" (22/M0), as the process-recurring cron would have.
  const anchor = parseLocalDate(ctx.date(0, ANCHOR_DAY));
  const booked = await processDueRules(db, anchor, { userId });
  log(`recurring: ${DEMO_RECURRING.length} rules, ${booked.generated} occurrences booked up to ${formatDateOnly(anchor)}`);
  return deductibleRuleIds;
}

/** Occurrences of deductible rules carry the flag (the rule's own isTaxDeductible is not applied at booking yet). */
async function markDeductibleOccurrences(ctx: Ctx, ruleIds: string[]) {
  if (!ruleIds.length) return;
  const rows = await ctx.db.ledgerEntry.findMany({ where: { userId: ctx.userId, recurringRuleId: { in: ruleIds }, isTaxDeductible: false, deletedAt: null }, select: { id: true } });
  for (const row of rows) await updateEntry(ctx.userId, row.id, { isTaxDeductible: true }, ctx.db);
}

async function seedEntries(ctx: Ctx) {
  const { db, userId } = ctx;
  for (const k of MOCK_MONTHS) {
    for (const e of MOCK_ENTRIES) {
      await createEntry(
        userId,
        {
          kind: e.kind,
          accountId: ctx.accounts[e.account].id,
          amount: scaledAmount(e.amount, k),
          description: typeof e.description === "function" ? e.description(k) : e.description,
          date: ctx.date(k, e.day),
          // No category = the categorization rules pick it (Pão de Açúcar, iFood, Uber).
          ...(e.category && { categoryId: ctx.categories[e.category] }),
          ...(e.deductible && { isTaxDeductible: true }),
        },
        db
      );
      counts.entries++;
    }
  }

  for (let k = -11; k <= 0; k++) {
    await createEntry(
      userId,
      {
        kind: "transfer",
        fromAccountId: ctx.accounts[PROFIT_DISTRIBUTION.from].id,
        toAccountId: ctx.accounts[PROFIT_DISTRIBUTION.to].id,
        amount: PROFIT_DISTRIBUTION.amount,
        description: PROFIT_DISTRIBUTION.description,
        date: ctx.date(k, PROFIT_DISTRIBUTION.day),
      },
      db
    );
    counts.transfers++;
  }

  await createEntry(
    userId,
    {
      kind: "expense",
      accountId: ctx.accounts[NOTEBOOK.account].id,
      amount: NOTEBOOK.amount,
      installments: NOTEBOOK.installments,
      description: NOTEBOOK.description,
      date: ctx.date(NOTEBOOK.k, NOTEBOOK.day),
      categoryId: ctx.categories[NOTEBOOK.category],
    },
    db
  );
  counts.entries += NOTEBOOK.installments;

  // What the yearly budgets already spent this year, in months before the mockup's three.
  const firstMock = monthIndex(addMonths(ctx.m0, -2));
  for (const row of YEARLY_HISTORY) {
    const k = monthIndex({ year: ctx.m0.year, month: row.month }) - monthIndex(ctx.m0);
    if (monthIndex(addMonths(ctx.m0, k)) >= firstMock) continue;
    await createEntry(
      userId,
      { kind: "expense", accountId: ctx.accounts[row.account].id, amount: row.amount, description: row.description(ctx.m0.year), date: ctx.date(k, row.day), categoryId: ctx.categories[row.category] },
      db
    );
    counts.entries++;
  }
}

// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------

/** Income fields of an operation (incomeType, taxWithheld): taken by recordOperation once the investments slice lands, ignored before. */
type IncomeFields = { incomeType?: PlannedIncome["incomeType"]; taxWithheld?: number };

async function seedInvestments(ctx: Ctx, plan: InvestmentPlan) {
  const { db, userId } = ctx;
  const holdingIds = {} as Record<HoldingKey, string>;
  for (const h of plan.holdings) {
    const holding = await createHolding(
      userId,
      { accountId: ctx.accounts[h.spec.account].id, assetClass: h.spec.assetClass, subType: h.spec.subType ?? null, ticker: h.spec.ticker, name: h.spec.name, currency: h.spec.currency },
      db
    );
    holdingIds[h.spec.key] = holding.id;
  }

  // Deposits into the brokers (XP's R$ 8.000 is the "Aporte mensal" recurring rule).
  for (const d of plan.deposits) {
    await createEntry(
      userId,
      {
        kind: "transfer",
        fromAccountId: ctx.accounts[d.from].id,
        toAccountId: ctx.accounts[d.broker].id,
        amount: d.amount,
        ...(d.toAmount !== undefined && { toAmount: d.toAmount }),
        date: ctx.date(d.k, d.day),
        direction: "investment_deposit",
      },
      db
    );
    counts.transfers++;
  }

  // Opening positions (M-12, paid from the brokers' opening cash) and the monthly buys, oldest first.
  const buys = plan.holdings.flatMap((h) => h.buys).sort((a, b) => a.k - b.k || a.day - b.day);
  for (const b of buys) {
    await recordOperation(userId, { holdingId: holdingIds[b.holding], type: "buy", quantity: b.quantity, pricePerUnit: b.price, totalAmount: b.amount, date: ctx.date(b.k, b.day) }, db);
    counts.operations++;
  }

  let incomeTypeStored = true;
  for (const i of [...plan.income].sort((a, b) => a.k - b.k || a.day - b.day)) {
    const input: OperationInput & IncomeFields = {
      holdingId: holdingIds[i.holding],
      type: i.incomeType === "interest" ? "yield_payment" : "dividend",
      totalAmount: i.gross,
      date: ctx.date(i.k, i.day),
      incomeType: i.incomeType,
      taxWithheld: i.taxWithheld,
    };
    const { operation } = await recordOperation(userId, input, db);
    if ((operation as { incomeType?: string | null }).incomeType == null) incomeTypeStored = false;
    counts.operations++;
  }
  if (!incomeTypeStored) log("note: recordOperation in this tree does not store incomeType/taxWithheld yet; proventos are plain dividends (JCP credited gross)");

  for (const h of plan.holdings) await updateHolding(userId, holdingIds[h.spec.key], { currentPrice: h.finalPrice }, db);

  await setTargets(userId, TARGETS.map((t) => ({ allocationClass: t.allocationClass, targetPercent: t.targetPercent })), db);
}

// ---------------------------------------------------------------------------
// Card bills, balances, FIRE
// ---------------------------------------------------------------------------

/** Pays every statement due by the anchor from the card's paying account, as a card_payment transfer linked to it. */
async function payCardBills(ctx: Ctx) {
  const { db, userId } = ctx;
  const anchor = parseLocalDate(ctx.date(0, ANCHOR_DAY));
  const statements = await db.cardStatement.findMany({
    where: { account: { userId }, paymentGroupId: null, dueDate: { lte: anchor } },
    include: { account: true, entries: { where: { deletedAt: null }, select: { amount: true } } },
    orderBy: [{ dueDate: "asc" }],
  });
  const byId = new Map(Object.values(ctx.accounts).map((a) => [a.id, a]));
  for (const s of statements) {
    const total = round(-s.entries.reduce((sum, e) => sum + Number(e.amount), 0), 2);
    const payFrom = s.account.payFromAccountId ? byId.get(s.account.payFromAccountId) : null;
    if (total <= 0 || !payFrom || !s.dueDate) continue;
    const description = st("pt-BR", "ledger.transferDescription", { direction: st("pt-BR", "ledger.direction.card_payment"), from: payFrom.name, to: s.account.name });
    const { entryIds } = await createEntry(userId, { kind: "expense", accountId: payFrom.id, amount: total, description, date: formatDateOnly(s.dueDate) }, db, { skipRules: true });
    await markStatementPayment(userId, entryIds[0], s.id, db);
    counts.bills++;
  }
}

/**
 * Mercury's three months of invoices leave it above the mockup's US$ 18.240;
 * the LLC distributes the surplus (LLC_DISTRIBUTION) so its opening balance
 * stays at or above zero and it still lands on the mockup's figure.
 */
async function distributeLlcSurplus(ctx: Ctx) {
  const { from, to, roundTo } = LLC_DISTRIBUTION;
  const target = DEMO_ACCOUNTS[from].balance ?? 0;
  const balances = await accountBalances(ctx.userId, ctx.db);
  const flows = (key: AccountKey) => (balances.get(ctx.accounts[key].id) ?? 0) - Number(ctx.accounts[key].initialBalance);
  const surplus = round(flows(from) - target, 2);
  if (surplus <= 0) return;
  const amount = Math.ceil(surplus / roundTo) * roundTo;
  // The destination ends at its own mockup balance, so its opening balance absorbs the amount.
  const headroom = round((DEMO_ACCOUNTS[to].balance ?? 0) - flows(to), 2);
  if (amount > headroom) {
    log(`note: ${DEMO_ACCOUNTS[to].name} has no room for a ${amount} distribution (${headroom}); ${DEMO_ACCOUNTS[from].name} keeps ${surplus} over the mockup`);
    return;
  }
  await createEntry(
    ctx.userId,
    {
      kind: "transfer",
      fromAccountId: ctx.accounts[from].id,
      toAccountId: ctx.accounts[to].id,
      amount,
      description: LLC_DISTRIBUTION.description,
      date: ctx.date(LLC_DISTRIBUTION.k, LLC_DISTRIBUTION.day),
      direction: "profit_distribution",
    },
    ctx.db
  );
  counts.transfers++;
  log(`LLC distribution: ${amount} ${ctx.accounts[from].currency} ${DEMO_ACCOUNTS[from].name} → ${DEMO_ACCOUNTS[to].name} on ${ctx.date(LLC_DISTRIBUTION.k, LLC_DISTRIBUTION.day)}`);
}

/** Opening balances so each account ends at the mockup's balance (never below zero). */
async function setOpeningBalances(ctx: Ctx) {
  const balances = await accountBalances(ctx.userId, ctx.db);
  for (const [key, spec] of Object.entries(DEMO_ACCOUNTS) as [AccountKey, (typeof DEMO_ACCOUNTS)[AccountKey]][]) {
    if (spec.balance === undefined) continue;
    const account = ctx.accounts[key];
    const flows = (balances.get(account.id) ?? 0) - Number(account.initialBalance);
    const initial = round(spec.balance - flows, 2);
    if (initial < 0) {
      log(`note: ${spec.name} would need a negative opening balance (${initial}); it ends at ${round(flows, 2)} ${spec.currency} instead of ${spec.balance}`);
      continue;
    }
    if (initial !== 0) await updateAccount(ctx.userId, account.id, { initialBalance: initial }, ctx.db);
  }
}

async function seedFire(ctx: Ctx) {
  await upsertFireGoal(ctx.userId, FireGoalInputSchema.parse(FIRE_GOAL), ctx.db);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function report(ctx: Ctx) {
  const { db, userId, m0 } = ctx;
  const [entries, groups, ops, holdings, budgets, rules, recurring, statements] = await Promise.all([
    db.ledgerEntry.count({ where: { userId, deletedAt: null } }),
    db.transferGroup.count({ where: { userId, deletedAt: null } }),
    db.investmentOperation.count({ where: { holding: { account: { userId } } } }),
    db.investmentHolding.count({ where: { account: { userId } } }),
    db.budget.count({ where: { userId } }),
    db.categorizationRule.findMany({ where: { userId }, select: { pattern: true, hitCount: true } }),
    db.recurringRule.count({ where: { userId } }),
    db.cardStatement.count({ where: { account: { userId } } }),
  ]);
  log(`rows: ${entries} ledger entries, ${groups} transfers, ${ops} operations on ${holdings} holdings, ${recurring} recurring rules, ${budgets} budgets, ${statements} card statements`);
  log(`rule hits: ${rules.map((r) => `${r.pattern} ${r.hitCount}`).join(", ")}`);
  // Read loosely: this is a printout, not a contract on the services' response shapes.
  const summary = (await portfolioSummary(userId, db)) as unknown as Record<string, unknown>;
  log(`portfolio: ${["marketValue", "invested", "cash", "netWorth"].map((k) => `${k} ${summary[k]}`).join(", ")}`);
  const overview = (await monthOverview(userId, m0.year, m0.month, db)) as unknown as { budgets?: { category: string; committed?: number; spent?: number; amount: number }[] };
  const spent = (overview.budgets ?? []).map((b) => `${b.category} ${b.committed ?? b.spent}/${b.amount}`).join(", ");
  log(`budgets ${label(m0)} (committed/amount): ${spent}`);
  const balances = await accountBalances(userId, db);
  log(`balances: ${Object.values(ctx.accounts).map((a) => `${a.name} ${round(balances.get(a.id) ?? 0, 2)} ${a.currency}`).join(" · ")}`);
}

function printPlan(m0: YearMonth, plan: InvestmentPlan, usdRate: number) {
  log(`dry run: M0 = ${label(m0)} (the mockup's September), anchor ${isoDate(m0, 0, ANCHOR_DAY)}, opening positions ${isoDate(m0, -12, 5)}`);
  for (const h of plan.holdings) {
    const rate = h.spec.currency === "USD" ? usdRate : 1;
    log(`${h.spec.ticker.padEnd(7)} ${String(h.quantity).padStart(12)} @ ${h.finalPrice} ${h.spec.currency} = R$ ${(h.value * rate).toFixed(0)} (mock ${h.spec.valueBrl}), cost R$ ${(h.cost * rate).toFixed(0)}, ${h.buys.length} buys`);
  }
  const deposits = new Map<number, number>();
  for (const d of plan.deposits) deposits.set(d.k, (deposits.get(d.k) ?? 0) + (d.from === "mercury" ? d.amount * usdRate : d.amount));
  log(`aportes per month (incl. R$ 8.000 to XP): ${[...deposits].map(([k, v]) => `${label(addMonths(m0, k))} ${(v + 8000).toFixed(0)}`).join(", ")}`);
  log(`proventos: ${plan.income.length} payments`);
}

async function seed(db: Db, m0: YearMonth, email: string, password: string) {
  const started = Date.now();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await db.user.delete({ where: { id: existing.id } });
    log(`deleted the previous ${email}`);
  }

  // The real signup: PF with its main account, BRL/USD/EUR, the system categories in pt-BR and the views.
  // The "PJ" default views are seeded on the first GET /v2/views, once the business entities below exist.
  const user = await signup({ email, password, name: DEMO_NAME, baseCurrency: "BRL", locale: "pt-BR" }, db);
  const userId = user.id;
  const entities = await seedEntities(db, userId);
  const accounts = await seedAccounts(db, userId, entities);
  const categories = await seedCategories(db, userId);
  const ctx: Ctx = { db, userId, m0, date: (k, day) => isoDate(m0, k, day), entities, accounts, categories };
  log(`user ${email} (${userId}), M0 = ${label(m0)}, entities and ${Object.keys(accounts).length} accounts, ${Object.keys(categories).length} categories, ${DEMO_RULES.length} rules`);

  await seedBudgets(ctx);
  const deductibleRules = await seedRecurring(ctx);
  await seedEntries(ctx);
  await markDeductibleOccurrences(ctx, deductibleRules);

  const fx = await loadFx(userId, db);
  await seedInvestments(ctx, planInvestments(fx.rateFor("USD")));
  await payCardBills(ctx);
  await distributeLlcSurplus(ctx);
  await setOpeningBalances(ctx);
  await seedFire(ctx);

  log(`booked ${counts.entries} entries, ${counts.transfers} transfers, ${counts.operations} investment operations, ${counts.bills} card bill payments in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await report(ctx);
  log(`log in as ${email} (password: DEMO_USER_PASSWORD, see .env.example)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const m0 = args.month ?? currentMonth();
  const email = (process.env.DEMO_USER_EMAIL || DEFAULT_DEMO_EMAIL).trim().toLowerCase();
  const password = process.env.DEMO_USER_PASSWORD || DEFAULT_DEMO_PASSWORD;
  if (!email.endsWith(DEMO_EMAIL_DOMAIN)) {
    throw new Error(`DEMO_USER_EMAIL must end in ${DEMO_EMAIL_DOMAIN}: the seed deletes and recreates that user`);
  }
  if (args.dryRun) {
    printPlan(m0, planInvestments(5.41), 5.41);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is unset (apps/capital/.env)");
  assertNonProductionDatabase(url, "seed-demo");
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await withMutationSource("system", () => seed(db, m0, email, password));
  } finally {
    await db.$disconnect();
  }
}

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // No .env: DATABASE_URL must come from the environment.
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
