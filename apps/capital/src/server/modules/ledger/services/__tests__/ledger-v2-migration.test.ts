import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../../../../..");
const migrationsDir = path.join(repoRoot, "apps/capital/prisma/migrations");
const queriesPath = path.join(repoRoot, "apps/capital/scripts/ledger-v2-check-queries.sql");
const precheckPath = path.join(repoRoot, "apps/capital/scripts/precheck-ledger-migration.sql");
const backfillPath = path.join(migrationsDir, "20261004200100_ledger_v2_backfill/migration.sql");
const retirePath = path.join(migrationsDir, "20261004200200_ledger_v2_retire_legacy/migration.sql");
const newUiPath = path.join(migrationsDir, "20261006000000_new_ui/migration.sql");
const currencyPath = path.join(migrationsDir, "20261006000100_currency_source_backfill/migration.sql");
const verifyPath = path.join(repoRoot, "apps/capital/scripts/verify-ledger-migration.sql");

const queriesSql = fs.readFileSync(queriesPath, "utf8");
const precheckSql = fs.readFileSync(precheckPath, "utf8");
const backfillSql = fs.readFileSync(backfillPath, "utf8");

function block(name: string): string {
  const match = queriesSql.match(new RegExp(`-- BEGIN ${name}\\n([\\s\\S]*?)\\n-- END ${name}`));
  if (!match?.[1]) throw new Error(`missing SQL block ${name}`);
  return match[1];
}

describe("ledger v2 check SQL", () => {
  it("keeps the precheck and the backfill on the same predicates", () => {
    for (const name of ["failures", "remaps", "fallbacks"]) {
      const text = block(name);
      expect(backfillSql).toContain(text);
      expect(precheckSql).toContain(text);
    }
    expect(precheckSql).toContain(block("flat-rates"));
    expect(precheckSql).toContain(block("shadowed"));
    expect(precheckSql).toContain(block("shadow-rows"));
    expect(backfillSql).toContain(block("shadow-rows"));
  });

  it("is a read-only script", () => {
    const stripped = precheckSql.replace(/--.*$/gm, "").replace(/\\echo[^\n]*/g, "");
    expect(stripped).toMatch(/BEGIN READ ONLY/);
    expect(stripped).toMatch(/\bROLLBACK\b/);
    for (const word of ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "RAISE"]) {
      expect(stripped).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

const TPL = "capital_ledger_v2_tpl_test";
const CASE = "capital_ledger_v2_case_test";

function connection() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is unset");
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

// Machines without a psql client (a Mac with Postgres only in Docker) run it
// inside the dev compose's `postgres` container instead; `-f` files are then
// piped in, since the container cannot see host paths.
const HOST_PSQL = spawnSync("psql", ["--version"], { encoding: "utf8" }).status === 0;
const PSQL_CONTAINER = process.env.CAPITAL_TEST_PSQL_CONTAINER ?? "postgres";

function psql(database: string, args: string[], input?: string): { status: number; stdout: string; stderr: string } {
  const creds = connection();
  const common = ["-U", creds.user, "-d", database, "-v", "ON_ERROR_STOP=1", "-X"];
  let result;
  if (HOST_PSQL) {
    result = spawnSync("psql", ["-h", creds.host, "-p", creds.port, ...common, ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, PGPASSWORD: creds.password },
    });
  } else {
    // psql skips stdin when -c is given, so a file run moves every -c in
    // front of the file's text, in the order psql would have run them.
    const fileAt = args.indexOf("-f");
    let stdin = input;
    let rest = args;
    if (fileAt >= 0) {
      const commands = args.flatMap((a, i) => (args[i - 1] === "-c" ? [`${a};`] : []));
      stdin = [...commands, fs.readFileSync(args[fileAt + 1], "utf8")].join("\n");
      rest = args.filter((a, i) => a !== "-c" && args[i - 1] !== "-c" && i !== fileAt && i !== fileAt + 1);
    }
    result = spawnSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${creds.password}`, PSQL_CONTAINER, "psql", ...common, ...rest], {
      encoding: "utf8",
      input: stdin,
    });
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function execSql(database: string, sql: string): void {
  const result = psql(database, ["-q"], sql);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function query(database: string, sql: string): string[][] {
  const result = psql(database, ["-A", "-t", "-F", "\t", "-c", sql]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

function scalar(database: string, sql: string): string {
  const rows = query(database, sql);
  return rows[0]?.[0] ?? "";
}

interface CheckRow {
  category: string;
  count: number;
  samples: string;
}

function checks(database: string, name: string, timeZone?: string): CheckRow[] {
  const sql = `${timeZone ? `SET TIME ZONE '${timeZone}';\n` : ""}SELECT category, row_count, coalesce(array_to_string(sample_ids, ', '), '') FROM (\n${block(name)}\n) s`;
  return query(database, sql).map(([category, count, samples]) => ({
    category: category ?? "",
    count: Number(count),
    samples: samples ?? "",
  }));
}

function resetCase(): void {
  execSql(
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${CASE}' AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS ${CASE};\nCREATE DATABASE ${CASE} TEMPLATE ${TPL};`,
  );
}

function seed(sql: string): void {
  execSql(CASE, sql);
}

const baseUser = `
INSERT INTO users (id, email, "passwordHash", name, "baseCurrency", "updatedAt")
VALUES ('user-1', 'user-1@example.com', 'x', 'User', 'BRL', now());
INSERT INTO personal_accounts (id, "userId", "updatedAt") VALUES ('pf-1', 'user-1', now());
INSERT INTO businesses (id, "userId", name, "updatedAt") VALUES ('biz-1', 'user-1', 'Biz', now());
`;

function runBackfill(timeZone?: string): { status: number; stderr: string } {
  const args = timeZone ? ["-c", `SET TIME ZONE '${timeZone}'`, "-q", "-f", backfillPath] : ["-q", "-f", backfillPath];
  return psql(CASE, args);
}

function expectRefusal(sql: string, category: string, id: string): void {
  resetCase();
  seed(baseUser + sql);
  const rows = checks(CASE, "failures").filter((row) => row.count > 0);
  const row = rows.find((item) => item.category === category);
  expect(row, rows.map((item) => item.category).join(", ")).toBeTruthy();
  expect(row?.samples).toContain(id);

  const result = runBackfill();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ledger backfill refused:");
  for (const item of rows) {
    expect(result.stderr).toContain(`${item.category}: ${item.count} [${item.samples}]`);
  }
  expect(scalar(CASE, "SELECT count(*) FROM ledger_entries")).toBe("0");
  expect(scalar(CASE, "SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '%ledger_v2_backfill%'")).toBe("0");
}

describe("ledger v2 migration", () => {
  beforeAll(() => {
    execSql(
      "postgres",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${TPL}', '${CASE}') AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS ${CASE};\nDROP DATABASE IF EXISTS ${TPL};\nCREATE DATABASE ${TPL};`,
    );
    const folders = fs
      .readdirSync(migrationsDir)
      .filter((name) => /^\d/.test(name))
      .sort();
    for (const folder of folders) {
      if (folder > "20261004200000_ledger_v2_schema") break;
      const result = psql(TPL, ["-q", "-f", path.join(migrationsDir, folder, "migration.sql")]);
      if (result.status !== 0) throw new Error(`${folder}\n${result.stderr}`);
    }
    execSql(
      TPL,
      `CREATE TABLE IF NOT EXISTS _prisma_migrations (
        id varchar(36) PRIMARY KEY,
        checksum varchar(64) NOT NULL,
        finished_at timestamptz,
        migration_name varchar(255) NOT NULL,
        logs text,
        rolled_back_at timestamptz,
        started_at timestamptz NOT NULL DEFAULT now(),
        applied_steps_count integer NOT NULL DEFAULT 0
      );`,
    );
  }, 120_000);

  afterAll(() => {
    execSql(
      "postgres",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${TPL}', '${CASE}') AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS ${CASE};\nDROP DATABASE IF EXISTS ${TPL};`,
    );
  });

  it("runs the precheck against an unmigrated database", () => {
    resetCase();
    const result = psql(CASE, ["-f", precheckPath]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("transactions without an account");
    expect(result.stdout).toContain("business brokerages mapped to the personal entity");
  });

  it("refuses a transaction with no account", () => {
    expectRefusal(
      `INSERT INTO transactions (id, "entityType", type, amount, currency, description, category, date, "updatedAt")
       VALUES ('tx-orphan', 'personal', 'expense', 10, 'BRL', 'x', 'Food', '2026-01-15 12:00:00+00', now());`,
      "transactions without an account",
      "tx-orphan",
    );
  });

  it("refuses a credit card with no owner", () => {
    expectRefusal(
      `INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "updatedAt")
       VALUES ('card-orphan', 'personal', 'Bank', '1234', 1000, 1, 10, 'BRL', now());`,
      "credit cards without an owner",
      "card-orphan",
    );
  });

  it("refuses a card purchase whose card was not mapped", () => {
    expectRefusal(
      `INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "updatedAt")
       VALUES ('card-orphan', 'personal', 'Bank', '1234', 1000, 1, 10, 'BRL', now());
       INSERT INTO credit_card_bills (id, "creditCardId", "closingDate", "dueDate", "totalAmount", "updatedAt")
       VALUES ('bill-orphan', 'card-orphan', '2026-01-20 12:00:00+00', '2026-01-27 12:00:00+00', 10, now());
       INSERT INTO bill_transactions (id, "billId", category, "transactionDate", description, amount, currency, "updatedAt")
       VALUES ('bt-orphan', 'bill-orphan', 'Food', '2026-01-15 12:00:00+00', 'coffee', 10, 'BRL', now());`,
      "card purchases whose card was not mapped",
      "bt-orphan",
    );
  });

  it("refuses a purchase with no card at all", () => {
    expectRefusal(
      `INSERT INTO bill_transactions (id, category, "transactionDate", description, amount, currency, "updatedAt")
       VALUES ('bt-nocard', 'Food', '2026-01-15 12:00:00+00', 'x', 5, 'BRL', now());`,
      "card purchases whose card was not mapped",
      "bt-nocard",
    );
  });

  it("refuses a transfer whose missing side is ambiguous", () => {
    expectRefusal(
      `INSERT INTO businesses (id, "userId", name, "updatedAt") VALUES ('biz-2', 'user-1', 'Other', now());
       INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "updatedAt", "fromPersonalAccountId")
       VALUES ('tr-ambiguous', 'personal', 'business', 'profit_distribution', 10, 'BRL', '2026-01-15 12:00:00+00', now(), 'pf-1');`,
      "transfers missing a side",
      "tr-ambiguous",
    );
  });

  it("refuses an investment account with no owner and no single business", () => {
    expectRefusal(
      `INSERT INTO users (id, email, "passwordHash", name, "baseCurrency", "updatedAt")
       VALUES ('user-2', 'user-2@example.com', 'x', 'Two', 'BRL', now());
       INSERT INTO businesses (id, "userId", name, "updatedAt") VALUES
         ('biz-a', 'user-2', 'A', now()), ('biz-b', 'user-2', 'B', now());
       INSERT INTO investment_accounts (id, "userId", name, "entityType", "updatedAt")
       VALUES ('ia-orphan', 'user-2', 'Broker', 'business', now());`,
      "investment accounts without an owner",
      "ia-orphan",
    );
  });

  it("refuses a budget with no owner", () => {
    expectRefusal(
      `INSERT INTO budgets (id, "entityType", category, amount, currency, period, year, "effectiveFrom", "updatedAt")
       VALUES ('bu-orphan', 'personal', 'Food', 100, 'BRL', 'monthly', 2026, '2026-01-01 12:00:00+00', now());`,
      "budgets without an owner",
      "bu-orphan",
    );
  });

  it("refuses a budget whose category is blank", () => {
    expectRefusal(
      `INSERT INTO budgets (id, "entityType", category, amount, currency, period, year, "effectiveFrom", "updatedAt", "personalAccountId")
       VALUES ('bu-blank', 'personal', '   ', 100, 'BRL', 'monthly', 2026, '2026-01-01 12:00:00+00', now(), 'pf-1');`,
      "budgets with an unmappable category",
      "bu-blank",
    );
  });

  it("refuses a reminder whose recurring item will not migrate", () => {
    expectRefusal(
      `INSERT INTO recurring_transactions (id, "entityType", type, amount, currency, description, category, frequency, "startDate", "nextDueDate", "updatedAt")
       VALUES ('rr-orphan', 'personal', 'expense', 10, 'BRL', 'rent', 'Home', 'monthly', '2026-01-01 12:00:00+00', '2026-02-01 12:00:00+00', now());
       INSERT INTO reminder_dispatches (id, "recurringTransactionId", "occurrenceDate", "daysBefore")
       VALUES ('rd-orphan', 'rr-orphan', '2026-02-01 12:00:00+00', 1);`,
      "reminder dispatches whose recurring item will not migrate",
      "rd-orphan",
    );
  });

  it("refuses a recurring transfer whose missing side is ambiguous", () => {
    expectRefusal(
      `INSERT INTO businesses (id, "userId", name, "updatedAt") VALUES ('biz-2', 'user-1', 'Other', now());
       INSERT INTO recurring_transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, frequency, "startDate", "nextDueDate", "updatedAt", "fromPersonalAccountId")
       VALUES ('rt-ambiguous', 'personal', 'business', 'profit_distribution', 10, 'BRL', 'monthly', '2026-01-01 12:00:00+00', '2026-02-01 12:00:00+00', now(), 'pf-1');`,
      "recurring transfers missing a side",
      "rt-ambiguous",
    );
  });

  it("refuses a statement and a legacy bill on an unmapped card", () => {
    expectRefusal(
      `INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "updatedAt")
       VALUES ('card-orphan', 'personal', 'Bank', '1234', 1000, 1, 10, 'BRL', now());
       INSERT INTO credit_card_statements (id, "creditCardId", month, "updatedAt")
       VALUES ('stmt-orphan', 'card-orphan', '2026-01', now());
       INSERT INTO credit_card_bills (id, "creditCardId", "closingDate", "dueDate", "totalAmount", "updatedAt")
       VALUES ('bill-orphan', 'card-orphan', '2026-01-20 12:00:00+00', '2026-01-27 12:00:00+00', 10, now());`,
      "card statements whose card was not mapped",
      "stmt-orphan",
    );
  });

  it("refuses an installment whose card was not mapped", () => {
    expectRefusal(
      `INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "updatedAt")
       VALUES ('card-orphan', 'personal', 'Bank', '1234', 1000, 1, 10, 'BRL', now());
       INSERT INTO credit_card_bills (id, "creditCardId", "closingDate", "dueDate", "totalAmount", "updatedAt")
       VALUES ('bill-orphan', 'card-orphan', '2026-01-20 12:00:00+00', '2026-01-27 12:00:00+00', 10, now());
       INSERT INTO bill_transactions (id, "billId", category, "transactionDate", description, amount, currency, "updatedAt")
       VALUES ('bt-orphan', 'bill-orphan', 'Food', '2026-01-15 12:00:00+00', 'coffee', 10, 'BRL', now());
       INSERT INTO installments (id, "creditCardId", "billTransactionId", description, "totalAmount", "totalInstallments", "startDate", "installmentAmount", "updatedAt")
       VALUES ('inst-orphan', 'card-orphan', 'bt-orphan', 'phone', 100, 10, '2026-01-15 12:00:00+00', 10, now());`,
      "installments whose card was not mapped",
      "inst-orphan",
    );
  });

  it("keeps the missing-rate day on the stored calendar date in any session zone", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "personalAccountId", "updatedAt")
         VALUES ('card-1', 'personal', 'Bank', '1234', 1000, 1, 10, 'USD', 'pf-1', now());
         INSERT INTO credit_card_statements (id, "creditCardId", month, "updatedAt")
         VALUES ('stmt-1', 'card-1', '2026-01', now());
         INSERT INTO bill_transactions (id, "statementId", category, "transactionDate", description, amount, currency, "updatedAt")
         VALUES ('bt-midnight', 'stmt-1', 'Food', '2026-01-15 00:00:00', 'coffee', 10, 'USD', now());`,
    );
    const zone = "America/Sao_Paulo";
    const row = checks(CASE, "failures", zone).find((item) => item.category.startsWith("missing exchange rate:"));
    expect(row?.category).toBe("missing exchange rate: purchase USD 2026-01-15");
    expect(row?.samples).toContain("bt-midnight");

    const result = runBackfill(zone);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing exchange rate: purchase USD 2026-01-15: 1 [bt-midnight]");
    expect(scalar(CASE, "SELECT count(*) FROM ledger_entries")).toBe("0");
  });

  it("lists foreign rows stored at exchangeRate 1 and still migrates them", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO transactions (id, "entityType", type, amount, currency, "exchangeRate", description, category, date, "personalAccountId", "updatedAt")
         VALUES
           ('tx-flat', 'personal', 'expense', 8, 'USD', 1, 'flat', 'Software', '2026-02-01 12:00:00', 'pf-1', now()),
           ('tx-rated', 'personal', 'expense', 8, 'USD', 4.5, 'rated', 'Software', '2026-02-02 12:00:00', 'pf-1', now()),
           ('tx-brl', 'personal', 'expense', 8, 'BRL', 1, 'local', 'Food', '2026-02-03 12:00:00', 'pf-1', now());
         INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, "exchangeRate", date, "fromPersonalAccountId", "toBusinessId", "updatedAt")
         VALUES
           ('tr-flat', 'personal', 'business', 'profit_distribution', 10, 'USD', 1, '2026-02-04 12:00:00', 'pf-1', 'biz-1', now()),
           ('tr-brl', 'personal', 'business', 'profit_distribution', 10, 'BRL', 1, '2026-02-05 12:00:00', 'pf-1', 'biz-1', now());`,
    );
    const listed = checks(CASE, "flat-rates");
    const transactions = listed.find((row) => row.category === "transactions stored at exchangeRate 1");
    const transfers = listed.find((row) => row.category === "transfers stored at exchangeRate 1");
    expect(transactions?.count).toBe(1);
    expect(transactions?.samples).toBe("tx-flat");
    expect(transfers?.count).toBe(1);
    expect(transfers?.samples).toBe("tr-flat");

    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(scalar(CASE, `SELECT "exchangeRate"::text FROM ledger_entries WHERE id = 'tx-flat'`)).toBe("1.00000000");
  });

  it("refuses a foreign purchase with no currency row", () => {
    expectRefusal(
      `INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "personalAccountId", "updatedAt")
       VALUES ('card-1', 'personal', 'Bank', '1234', 1000, 1, 10, 'USD', 'pf-1', now());
       INSERT INTO credit_card_statements (id, "creditCardId", month, "updatedAt")
       VALUES ('stmt-1', 'card-1', '2026-01', now());
       INSERT INTO bill_transactions (id, "statementId", category, "transactionDate", description, amount, currency, "updatedAt")
       VALUES ('bt-usd', 'stmt-1', 'Food', '2026-01-15 12:00:00+00', 'coffee', 10, 'USD', now());`,
      "missing exchange rate: purchase USD 2026-01-15",
      "bt-usd",
    );
  });

  it("refuses a foreign purchase when manualRate is not positive", () => {
    expectRefusal(
      `INSERT INTO currencies (id, "userId", code, name, symbol, "manualRate", "updatedAt")
       VALUES ('cur-usd', 'user-1', 'USD', 'Dollar', '$', 0, now());
       INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "personalAccountId", "updatedAt")
       VALUES ('card-1', 'personal', 'Bank', '1234', 1000, 1, 10, 'USD', 'pf-1', now());
       INSERT INTO credit_card_statements (id, "creditCardId", month, "updatedAt")
       VALUES ('stmt-1', 'card-1', '2026-01', now());
       INSERT INTO bill_transactions (id, "statementId", category, "transactionDate", description, amount, currency, "updatedAt")
       VALUES ('bt-usd', 'stmt-1', 'Food', '2026-01-15 12:00:00+00', 'coffee', 10, 'USD', now());`,
      "missing exchange rate: purchase USD 2026-01-15",
      "bt-usd",
    );
  });

  it("refuses investment cash in a foreign currency with no rate", () => {
    expectRefusal(
      `INSERT INTO investment_accounts (id, "userId", name, "entityType", currency, "personalAccountId", "updatedAt")
       VALUES ('ia-usd', 'user-1', 'IB', 'personal', 'USD', 'pf-1', now());
       INSERT INTO investment_holdings (id, "accountId", "assetClass", name, "updatedAt")
       VALUES ('h-1', 'ia-usd', 'stocks', 'AAPL', now());
       INSERT INTO investment_transactions (id, "holdingId", type, "totalAmount", date, "updatedAt")
       VALUES ('it-usd', 'h-1', 'deposit', 100, '2026-03-01 12:00:00+00', now());`,
      "missing exchange rate: investment USD 2026-03-01",
      "it-usd",
    );
  });

  it("refuses a transaction and a transfer that share an externalId on one account", () => {
    expectRefusal(
      `INSERT INTO transactions (id, "entityType", type, amount, currency, description, category, date, "externalId", "personalAccountId", "updatedAt")
       VALUES ('tx-clash', 'personal', 'expense', 10, 'BRL', 'x', 'Food', '2026-01-15 12:00:00+00', 'clash', 'pf-1', now());
       INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "externalId", "fromPersonalAccountId", "toBusinessId", "updatedAt")
       VALUES ('tr-clash', 'personal', 'business', 'profit_distribution', 10, 'BRL', '2026-01-15 12:00:00+00', 'clash', 'pf-1', 'biz-1', now());`,
      "externalId collision",
      "transaction:tx-clash",
    );
  });

  it("refuses two transfers that share an externalId on one account", () => {
    expectRefusal(
      `INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "externalId", "fromPersonalAccountId", "toBusinessId", "updatedAt")
       VALUES
         ('tr-dup-1', 'personal', 'business', 'profit_distribution', 10, 'BRL', '2026-01-15 12:00:00+00', 'dup', 'pf-1', 'biz-1', now()),
         ('tr-dup-2', 'personal', 'business', 'profit_distribution', 5, 'BRL', '2026-01-16 12:00:00+00', 'dup', 'pf-1', 'biz-1', now());`,
      "externalId collision",
      "transfer:tr-dup-1",
    );
  });

  it("lists every problem in one exception", () => {
    expectRefusal(
      `INSERT INTO transactions (id, "entityType", type, amount, currency, description, category, date, "updatedAt")
       VALUES ('tx-orphan', 'personal', 'expense', 10, 'BRL', 'x', 'Food', '2026-01-15 12:00:00+00', now());
       INSERT INTO budgets (id, "entityType", category, amount, currency, period, year, "effectiveFrom", "updatedAt")
       VALUES ('bu-orphan', 'personal', 'Food', 100, 'BRL', 'monthly', 2026, '2026-01-01 12:00:00+00', now());`,
      "transactions without an account",
      "tx-orphan",
    );
  });

  it("migrates a reimbursement whose missing side the single-owner rule fills in", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "fromBusinessId", "updatedAt")
         VALUES ('tr-reimb-to', 'business', 'personal', 'reimbursement', 200, 'BRL', '2026-01-15 12:00:00', 'biz-1', now());
         INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "toPersonalAccountId", "updatedAt")
         VALUES ('tr-reimb-from', 'business', 'personal', 'reimbursement', 200, 'BRL', '2026-01-15 12:00:00', 'pf-1', now());`,
    );
    const remapped = checks(CASE, "remaps").find((row) => row.category === "transfers the new rule will map");
    expect(remapped?.samples.split(", ")).toEqual(expect.arrayContaining(["tr-reimb-to", "tr-reimb-from"]));
    expect(checks(CASE, "failures").every((row) => row.count === 0)).toBe(true);

    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(scalar(CASE, `SELECT "entityId" FROM ledger_entries WHERE id = 'tr-reimb-to'`)).toBe("biz-1");
    expect(scalar(CASE, `SELECT "amountBase"::text FROM ledger_entries WHERE id = 'tr-reimb-to'`)).toBe("-200.0000");
    expect(scalar(CASE, `SELECT "entityId" FROM ledger_entries WHERE id = md5('transfer-to:' || 'tr-reimb-to')::uuid::text`)).toBe("pf-1");
    expect(scalar(CASE, `SELECT "amountBase"::text FROM ledger_entries WHERE id = md5('transfer-to:' || 'tr-reimb-to')::uuid::text`)).toBe("200.0000");
    expect(scalar(CASE, `SELECT "entityId" FROM ledger_entries WHERE id = 'tr-reimb-from'`)).toBe("biz-1");
    expect(scalar(CASE, `SELECT "entityId" FROM ledger_entries WHERE id = md5('transfer-to:' || 'tr-reimb-from')::uuid::text`)).toBe("pf-1");
  });

  it("maps a missing transfer side when the user has one personal account", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "fromBusinessId", "updatedAt")
         VALUES ('tr-fill', 'business', 'personal', 'profit_distribution', 30, 'BRL', '2026-01-15 12:00:00+00', 'biz-1', now());`,
    );
    const remapped = checks(CASE, "remaps").find((row) => row.category === "transfers the new rule will map");
    expect(remapped?.samples.split(", ")).toContain("tr-fill");
    expect(checks(CASE, "failures").every((row) => row.count === 0)).toBe(true);

    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("tr-fill");
    expect(scalar(CASE, `SELECT count(*) FROM ledger_entries WHERE "transferGroupId" = 'tr-fill'`)).toBe("2");
    const toAccount = scalar(CASE, `SELECT md5('default-checking:' || 'pf-1')::uuid::text`);
    expect(scalar(CASE, `SELECT "accountId" FROM ledger_entries WHERE id = md5('transfer-to:' || 'tr-fill')::uuid::text`)).toBe(toAccount);
  });

  it("maps an ownerless business brokerage when the user has one business and no personal entity", () => {
    resetCase();
    seed(
      `INSERT INTO users (id, email, "passwordHash", name, "baseCurrency", "updatedAt")
       VALUES ('user-2', 'user-2@example.com', 'x', 'Solo', 'BRL', now());
       INSERT INTO businesses (id, "userId", name, "updatedAt") VALUES ('biz-only', 'user-2', 'Only', now());
       INSERT INTO investment_accounts (id, "userId", name, "entityType", "updatedAt")
       VALUES ('ia-fill', 'user-2', 'Broker', 'business', now());`,
    );
    const remapped = checks(CASE, "remaps").find((row) => row.category === "investment accounts the new rule will map");
    expect(remapped?.samples.split(", ")).toContain("ia-fill");
    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(scalar(CASE, `SELECT "entityId" FROM accounts WHERE id = 'ia-fill'`)).toBe("biz-only");
  });

  it("uses currencies.manualRate for a purchase and the row rate for a transaction", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO currencies (id, "userId", code, name, symbol, "manualRate", "updatedAt")
         VALUES ('cur-usd', 'user-1', 'USD', 'Dollar', '$', 0.2, now());
         INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "personalAccountId", "updatedAt")
         VALUES ('card-1', 'personal', 'Bank', '1234', 1000, 1, 10, 'USD', 'pf-1', now());
         INSERT INTO credit_card_statements (id, "creditCardId", month, "updatedAt")
         VALUES ('stmt-1', 'card-1', '2026-01', now());
         INSERT INTO bill_transactions (id, "statementId", category, "transactionDate", description, amount, currency, "updatedAt")
         VALUES ('bt-usd', 'stmt-1', 'Food', '2026-01-15 12:00:00+00', 'coffee', 10, 'USD', now());
         INSERT INTO transactions (id, "entityType", type, amount, currency, "exchangeRate", description, category, date, "personalAccountId", "updatedAt")
         VALUES ('tx-usd', 'personal', 'expense', 10, 'USD', 4.5, 'saas', 'Software', '2026-01-15 12:00:00+00', 'pf-1', now());`,
    );
    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(query(CASE, `SELECT "exchangeRate"::text, "amountBase"::text FROM ledger_entries WHERE id = 'bt-usd'`)).toEqual([["5.00000000", "-50.0000"]]);
    expect(query(CASE, `SELECT "exchangeRate"::text, "amountBase"::text FROM ledger_entries WHERE id = 'tx-usd'`)).toEqual([["4.50000000", "-45.0000"]]);
  });

  it("keeps a foreign transaction's own exchangeRate when no currency row exists", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO transactions (id, "entityType", type, amount, currency, "exchangeRate", description, category, date, "personalAccountId", "updatedAt")
         VALUES ('tx-flat', 'personal', 'expense', 8, 'USD', 1, 'flat', 'Software', '2026-02-01 12:00:00+00', 'pf-1', now());`,
    );
    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(scalar(CASE, `SELECT "exchangeRate"::text FROM ledger_entries WHERE id = 'tx-flat'`)).toBe("1.00000000");
  });

  it("allows the same externalId on two different accounts", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO transactions (id, "entityType", type, amount, currency, description, category, date, "externalId", "personalAccountId", "updatedAt")
         VALUES ('tx-shared', 'personal', 'expense', 10, 'BRL', 'x', 'Food', '2026-01-15 12:00:00+00', 'shared', 'pf-1', now());
         INSERT INTO investment_accounts (id, "userId", name, "entityType", "personalAccountId", "updatedAt")
         VALUES ('ia-1', 'user-1', 'Broker', 'personal', 'pf-1', now());
         INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "externalId", "fromInvestmentAccountId", "toBusinessId", "updatedAt")
         VALUES ('tr-shared', 'personal', 'business', 'investment_deposit', 10, 'BRL', '2026-01-15 12:00:00+00', 'shared', 'ia-1', 'biz-1', now());`,
    );
    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(scalar(CASE, `SELECT count(*) FROM ledger_entries WHERE "externalId" = 'shared'`)).toBe("2");
  });

  it("lists a business brokerage that falls back to the personal entity and still migrates it", () => {
    resetCase();
    seed(
      baseUser +
        `INSERT INTO investment_accounts (id, "userId", name, "entityType", "updatedAt")
         VALUES ('ia-fallback', 'user-1', 'PJ Broker', 'business', now());`,
    );
    const listed = checks(CASE, "fallbacks")[0];
    expect(listed?.category).toBe("business brokerages mapped to the personal entity");
    expect(listed?.samples.split(", ")).toContain("ia-fallback");
    const result = runBackfill();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("ia-fallback");
    expect(scalar(CASE, `SELECT "entityId" FROM accounts WHERE id = 'ia-fallback'`)).toBe("pf-1");
  });

  it("applies the good path, archives dropped links, and leaves verify green", () => {
    resetCase();
    seed(`
      INSERT INTO users (id, email, "passwordHash", name, "baseCurrency", "updatedAt")
      VALUES ('user-1', 'user-1@example.com', 'x', 'User', 'BRL', now());
      INSERT INTO personal_accounts (id, "userId", "updatedAt") VALUES ('pf-1', 'user-1', now());
      INSERT INTO businesses (id, "userId", name, "updatedAt") VALUES ('biz-1', 'user-1', 'Biz', now());
      INSERT INTO currencies (id, "userId", code, name, symbol, "manualRate", "updatedAt")
      VALUES ('cur-usd', 'user-1', 'USD', 'Dollar', '$', 0.2, now());
      INSERT INTO transactions (id, "entityType", type, amount, currency, description, category, date, "personalAccountId", "updatedAt")
      VALUES ('tx-brl', 'personal', 'expense', 10, 'BRL', 'lunch', 'Food', '2026-01-10 12:00:00+00', 'pf-1', now());
      INSERT INTO transactions (id, "entityType", type, amount, currency, "exchangeRate", description, category, date, "personalAccountId", "updatedAt")
      VALUES ('tx-usd', 'personal', 'expense', 10, 'USD', 4.5, 'saas', 'Software', '2026-01-11 12:00:00+00', 'pf-1', now());
      INSERT INTO transfers (id, "fromEntityType", "toEntityType", direction, amount, currency, date, "fromPersonalAccountId", "toBusinessId", "updatedAt")
      VALUES ('tr-1', 'personal', 'business', 'profit_distribution', 30, 'BRL', '2026-01-12 12:00:00+00', 'pf-1', 'biz-1', now());
      INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "personalAccountId", "updatedAt")
      VALUES ('card-1', 'personal', 'Bank', '1234', 5000, 20, 27, 'BRL', 'pf-1', now());
      INSERT INTO credit_card_statements (id, "creditCardId", month, "closingDate", "dueDate", "updatedAt")
      VALUES ('stmt-1', 'card-1', '2026-01', '2026-01-20 12:00:00+00', '2026-01-27 12:00:00+00', now());
      INSERT INTO bill_transactions (id, "statementId", category, "transactionDate", description, amount, currency, "updatedAt")
      VALUES
        ('bt-brl', 'stmt-1', 'Food', '2026-01-05 12:00:00+00', 'market', 20, 'BRL', now()),
        ('bt-usd', 'stmt-1', 'Food', '2026-01-06 12:00:00+00', 'coffee', 10, 'USD', now());
      INSERT INTO budgets (id, "entityType", category, amount, currency, period, year, "effectiveFrom", "personalAccountId", "updatedAt")
      VALUES ('bu-1', 'personal', 'Food', 500, 'BRL', 'monthly', 2026, '2026-01-01 12:00:00+00', 'pf-1', now());
      INSERT INTO recurring_transactions (id, "entityType", type, amount, currency, description, category, frequency, "startDate", "nextDueDate", "personalAccountId", "updatedAt")
      VALUES ('rr-1', 'personal', 'expense', 80, 'BRL', 'rent', 'Home', 'monthly', '2026-01-01 12:00:00+00', '2026-02-01 12:00:00+00', 'pf-1', now());
      INSERT INTO reminder_dispatches (id, "recurringTransactionId", "occurrenceDate", "daysBefore")
      VALUES ('rd-1', 'rr-1', '2026-02-01 12:00:00+00', 1);
      INSERT INTO attachments (id, kind, "blobUrl", pathname, "mimeType", "sizeBytes", "originalName", "transactionId")
      VALUES ('att-1', 'RECEIPT', 'https://example.test/a', 'a.pdf', 'application/pdf', 10, 'a.pdf', 'tx-brl');
      INSERT INTO investment_accounts (id, "userId", name, "entityType", "personalAccountId", "updatedAt")
      VALUES ('ia-1', 'user-1', 'Broker', 'personal', 'pf-1', now());
      INSERT INTO investment_accounts (id, "userId", name, "entityType", "updatedAt")
      VALUES ('ia-fallback', 'user-1', 'PJ Broker', 'business', now());
      INSERT INTO investment_holdings (id, "accountId", "assetClass", name, "updatedAt")
      VALUES ('h-1', 'ia-1', 'stocks', 'PETR4', now());
      INSERT INTO investment_transactions (id, "holdingId", type, "totalAmount", date, "updatedAt")
      VALUES ('it-1', 'h-1', 'deposit', 100, '2026-01-08 12:00:00+00', now());
    `);

    const backfill = runBackfill();
    expect(backfill.status, backfill.stderr).toBe(0);
    for (const file of [retirePath, newUiPath, currencyPath]) {
      const result = psql(CASE, ["-q", "-f", file]);
      expect(result.status, `${file}\n${result.stderr}`).toBe(0);
    }

    const verify = psql(CASE, ["-f", verifyPath]);
    expect(verify.status, verify.stderr).toBe(0);

    expect(scalar(CASE, `SELECT "transactionId" FROM legacy.attachment_links WHERE id = 'att-1'`)).toBe("tx-brl");
    expect(query(CASE, `SELECT category, "personalAccountId" FROM legacy.budget_links WHERE id = 'bu-1'`)).toEqual([["Food", "pf-1"]]);
    expect(scalar(CASE, `SELECT "recurringTransactionId" FROM legacy.reminder_dispatch_links WHERE id = 'rd-1'`)).toBe("rr-1");
    expect(
      scalar(
        CASE,
        `SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'attachments' AND column_name = 'transactionId'`,
      ),
    ).toBe("0");
    expect(
      scalar(
        CASE,
        `SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'budgets' AND column_name IN ('category', 'businessId', 'personalAccountId', 'entityType')`,
      ),
    ).toBe("0");
    expect(scalar(CASE, `SELECT "exchangeRate"::text FROM ledger_entries WHERE id = 'bt-usd'`)).toBe("5.00000000");
    expect(scalar(CASE, `SELECT "amountBase"::text FROM ledger_entries WHERE id = 'tx-usd'`)).toBe("-45.0000");
    expect(scalar(CASE, `SELECT id FROM legacy.investment_accounts ia WHERE ia.id = 'ia-fallback' AND ia."entityType" = 'business'`)).toBe("ia-fallback");
    expect(scalar(CASE, `SELECT "entityId" FROM accounts WHERE id = 'ia-fallback'`)).toBe("pf-1");
    expect(scalar(CASE, `SELECT count(*) FROM legacy.attachment_links`)).toBe(scalar(CASE, `SELECT count(*) FROM attachments`));
    expect(scalar(CASE, `SELECT count(*) FROM legacy.budget_links`)).toBe(scalar(CASE, `SELECT count(*) FROM budgets`));
    expect(scalar(CASE, `SELECT count(*) FROM legacy.reminder_dispatch_links`)).toBe(scalar(CASE, `SELECT count(*) FROM reminder_dispatches`));
  });

  it("skips bill purchases whose payment is already a statement settlement", () => {
    resetCase();
    seed(baseUser + `
      INSERT INTO credit_cards (id, "entityType", "bankName", "lastFourDigits", "creditLimit", "closingDay", "dueDay", currency, "personalAccountId", "updatedAt")
      VALUES
        ('card-3308', 'personal', 'Bank', '3308', 5000, 20, 27, 'BRL', 'pf-1', now()),
        ('card-2361', 'personal', 'Bank', '2361', 5000, 20, 27, 'BRL', 'pf-1', now()),
        ('card-legacy', 'personal', 'Bank', '0001', 5000, 20, 27, 'BRL', 'pf-1', now()),
        ('card-open', 'personal', 'Bank', '0002', 5000, 20, 27, 'BRL', 'pf-1', now()),
        ('card-stmt', 'personal', 'Bank', '0003', 5000, 20, 27, 'BRL', 'pf-1', now());

      INSERT INTO transactions (id, "entityType", type, amount, currency, description, category, date, "personalAccountId", "updatedAt")
      VALUES
        ('tx-lunch', 'personal', 'expense', 5, 'BRL', 'lunch', 'Food', '2026-06-02 12:00:00+00', 'pf-1', now()),
        ('pay-3308-06', 'personal', 'expense', 55, 'BRL', 'card payment', 'Credit Card', '2026-06-21 12:00:00+00', 'pf-1', now()),
        ('pay-3308-07', 'personal', 'expense', 60, 'BRL', 'card payment', 'Credit Card', '2026-07-21 12:00:00+00', 'pf-1', now()),
        ('pay-3308-08', 'personal', 'expense', 70, 'BRL', 'card payment', 'Credit Card', '2026-08-21 12:00:00+00', 'pf-1', now()),
        ('pay-3308-09', 'personal', 'expense', 80, 'BRL', 'card payment', 'Credit Card', '2026-09-21 12:00:00+00', 'pf-1', now()),
        ('pay-2361-06', 'personal', 'expense', 680, 'BRL', 'legacy bill', 'Credit Card', '2026-06-12 12:00:00+00', 'pf-1', now()),
        ('pay-2361-07', 'personal', 'expense', 680, 'BRL', 'legacy bill', 'Credit Card', '2026-07-12 12:00:00+00', 'pf-1', now()),
        ('pay-legacy', 'personal', 'expense', 100, 'BRL', 'legacy bill', 'Credit Card', '2026-03-10 12:00:00+00', 'pf-1', now());

      INSERT INTO credit_card_statements (id, "creditCardId", month, "closingDate", "dueDate", "billPaymentTransactionId", "updatedAt")
      VALUES
        ('stmt-3308-06', 'card-3308', '2026-06', '2026-06-20 12:00:00+00', '2026-06-27 12:00:00+00', 'pay-3308-06', now()),
        ('stmt-3308-07', 'card-3308', '2026-07', '2026-07-20 12:00:00+00', '2026-07-27 12:00:00+00', 'pay-3308-07', now()),
        ('stmt-3308-08', 'card-3308', '2026-08', '2026-08-20 12:00:00+00', '2026-08-27 12:00:00+00', 'pay-3308-08', now()),
        ('stmt-3308-09', 'card-3308', '2026-09', '2026-09-20 12:00:00+00', '2026-09-27 12:00:00+00', 'pay-3308-09', now()),
        ('stmt-2361-06', 'card-2361', '2026-06', '2026-06-18 12:00:00+00', '2026-06-25 12:00:00+00', NULL, now()),
        ('stmt-2361-07', 'card-2361', '2026-07', '2026-07-18 12:00:00+00', '2026-07-25 12:00:00+00', NULL, now()),
        ('stmt-05', 'card-stmt', '2026-05', '2026-05-20 12:00:00+00', '2026-05-27 12:00:00+00', NULL, now());

      INSERT INTO credit_card_bills (id, "creditCardId", "transactionId", "closingDate", "dueDate", "totalAmount", "updatedAt")
      VALUES
        ('bill-3308-06', 'card-3308', 'pay-3308-06', '2026-06-20 12:00:00+00', '2026-06-27 12:00:00+00', 55, now()),
        ('bill-3308-07', 'card-3308', 'pay-3308-07', '2026-07-20 12:00:00+00', '2026-07-27 12:00:00+00', 60, now()),
        ('bill-3308-08', 'card-3308', 'pay-3308-08', '2026-08-20 12:00:00+00', '2026-08-27 12:00:00+00', 70, now()),
        ('bill-3308-09', 'card-3308', 'pay-3308-09', '2026-09-20 12:00:00+00', '2026-09-27 12:00:00+00', 80, now()),
        ('bill-2361-06', 'card-2361', 'pay-2361-06', '2026-06-20 12:00:00+00', '2026-06-27 12:00:00+00', 680, now()),
        ('bill-2361-07', 'card-2361', 'pay-2361-07', '2026-07-20 12:00:00+00', '2026-07-27 12:00:00+00', 680, now()),
        ('bill-legacy', 'card-legacy', 'pay-legacy', '2026-03-20 12:00:00+00', '2026-03-27 12:00:00+00', 100, now()),
        ('bill-open', 'card-open', NULL, '2026-04-20 12:00:00+00', '2026-04-27 12:00:00+00', 25, now());

      INSERT INTO bill_transactions (id, "statementId", "billId", category, "transactionDate", description, amount, currency, "updatedAt")
      VALUES
        ('bt-3308-06-stmt-1', 'stmt-3308-06', NULL, 'Food', '2026-06-05 12:00:00+00', 'market', 10, 'BRL', now()),
        ('bt-3308-06-stmt-2', 'stmt-3308-06', NULL, 'Food', '2026-06-06 12:00:00+00', 'market', 20, 'BRL', now()),
        ('bt-3308-06-bill-1', NULL, 'bill-3308-06', 'Food', '2026-06-03 12:00:00+00', 'old import', 22, 'BRL', now()),
        ('bt-3308-06-bill-2', NULL, 'bill-3308-06', 'Food', '2026-06-04 12:00:00+00', 'old import', 28, 'BRL', now()),
        ('bt-3308-07-stmt', 'stmt-3308-07', NULL, 'Food', '2026-07-05 12:00:00+00', 'market', 40, 'BRL', now()),
        ('bt-3308-07-bill-1', NULL, 'bill-3308-07', 'Food', '2026-07-03 12:00:00+00', 'old import', 25, 'BRL', now()),
        ('bt-3308-07-bill-2', NULL, 'bill-3308-07', 'Food', '2026-07-04 12:00:00+00', 'old import', 35, 'BRL', now()),
        ('bt-3308-08-stmt', 'stmt-3308-08', NULL, 'Food', '2026-08-05 12:00:00+00', 'market', 15, 'BRL', now()),
        ('bt-3308-08-bill', NULL, 'bill-3308-08', 'Food', '2026-08-03 12:00:00+00', 'old import', 70, 'BRL', now()),
        ('bt-3308-09-stmt', 'stmt-3308-09', NULL, 'Food', '2026-09-05 12:00:00+00', 'market', 25, 'BRL', now()),
        ('bt-3308-09-bill-1', NULL, 'bill-3308-09', 'Food', '2026-09-03 12:00:00+00', 'old import', 40, 'BRL', now()),
        ('bt-3308-09-bill-2', NULL, 'bill-3308-09', 'Food', '2026-09-04 12:00:00+00', 'old import', 40, 'BRL', now()),
        ('bt-2361-06-stmt', 'stmt-2361-06', NULL, 'Food', '2026-06-08 12:00:00+00', 'coffee', 12, 'BRL', now()),
        ('bt-2361-06', NULL, 'bill-2361-06', 'Food', '2026-06-04 12:00:00+00', 'legacy purchase', 680, 'BRL', now()),
        ('bt-2361-07-stmt', 'stmt-2361-07', NULL, 'Food', '2026-07-08 12:00:00+00', 'coffee', 8, 'BRL', now()),
        ('bt-2361-07', NULL, 'bill-2361-07', 'Food', '2026-07-04 12:00:00+00', 'legacy purchase', 680, 'BRL', now()),
        ('bt-legacy', NULL, 'bill-legacy', 'Food', '2026-03-05 12:00:00+00', 'legacy purchase', 80, 'BRL', now()),
        ('bt-open', NULL, 'bill-open', 'Food', '2026-04-02 12:00:00+00', 'unlinked', 25, 'BRL', now()),
        ('bt-stmt-05', 'stmt-05', NULL, 'Food', '2026-05-03 12:00:00+00', 'statement only', 15, 'BRL', now());
    `);

    const shadow = query(
      CASE,
      `SELECT row_count::text, amount_abs_sum::text, coalesce(array_to_string(sample_ids, ', '), '') FROM (\n${block("shadowed")}\n) s`,
    );
    expect(shadow[0]?.[0]).toBe("7");
    expect(shadow[0]?.[1]).toBe("260.00");
    expect(shadow[0]?.[2].split(", ")).toEqual(
      expect.arrayContaining(["bt-3308-06-bill-1", "bt-3308-06-bill-2"]),
    );
    expect(shadow[0]?.[2]).not.toContain("bt-2361-06");

    const backfill = runBackfill();
    expect(backfill.status, backfill.stderr).toBe(0);

    expect(scalar(CASE, `SELECT count(*) FROM ledger_entries WHERE id LIKE 'bt-3308-%-bill%'`)).toBe("0");
    expect(scalar(CASE, `SELECT new_model FROM legacy.id_map WHERE old_model = 'BillTransaction' AND old_id = 'bt-3308-06-bill-1'`)).toBe(
      "SupersededBillPurchase",
    );
    expect(scalar(CASE, `SELECT count(*) FROM legacy.id_map WHERE new_model = 'SupersededBillPurchase'`)).toBe("7");
    expect(scalar(CASE, `SELECT kind FROM ledger_entries WHERE id = 'pay-3308-06'`)).toBe("transfer");
    expect(scalar(CASE, `SELECT count(*) FROM ledger_entries WHERE metadata->>'billId' LIKE 'bill-3308-%'`)).toBe("0");

    expect(query(CASE, `SELECT kind, "amountBase"::text FROM ledger_entries WHERE id = 'bt-2361-06'`)).toEqual([["expense", "-680.0000"]]);
    expect(query(CASE, `SELECT kind, "amountBase"::text FROM ledger_entries WHERE id = 'bt-2361-07'`)).toEqual([["expense", "-680.0000"]]);
    expect(scalar(CASE, `SELECT count(*) FROM ledger_entries WHERE metadata->>'billId' LIKE 'bill-2361-%'`)).toBe("0");
    expect(scalar(CASE, `SELECT "amountBase"::text FROM ledger_entries WHERE metadata->>'billId' = 'bill-legacy'`)).toBe("-20.0000");
    expect(scalar(CASE, `SELECT kind FROM ledger_entries WHERE id = 'bt-open'`)).toBe("expense");
    expect(scalar(CASE, `SELECT kind FROM ledger_entries WHERE id = 'bt-stmt-05'`)).toBe("expense");

    expect(
      query(
        CASE,
        `SELECT to_char(date_trunc('month', "effectiveDate"), 'YYYY-MM'),
                round((-sum("amountBase"))::numeric, 2)::text
         FROM ledger_entries
         WHERE "entityId" = 'pf-1' AND kind = 'expense'
         GROUP BY 1 ORDER BY 1`,
      ),
    ).toEqual([
      ["2026-03", "100.00"],
      ["2026-04", "25.00"],
      ["2026-05", "15.00"],
      ["2026-06", "727.00"],
      ["2026-07", "728.00"],
      ["2026-08", "15.00"],
      ["2026-09", "25.00"],
    ]);

    const retired = psql(CASE, ["-q", "-f", retirePath]);
    expect(retired.status, retired.stderr).toBe(0);
    const verify = psql(CASE, ["-f", verifyPath]);
    expect(verify.status, verify.stderr).toBe(0);
    expect(verify.stdout).toContain("skipped_n");
    expect(scalar(CASE, `SELECT count(*)::text FROM legacy.id_map WHERE old_model = 'BillTransaction' AND new_model = 'SupersededBillPurchase'`)).toBe("7");
    expect(
      scalar(
        CASE,
        `SELECT round(coalesce(sum(abs(bt.amount)), 0)::numeric, 2)::text
         FROM legacy.bill_transactions bt
         JOIN legacy.id_map m ON m.old_id = bt.id AND m.old_model = 'BillTransaction' AND m.new_model = 'SupersededBillPurchase'`,
      ),
    ).toBe("260.00");
    expect(
      scalar(
        CASE,
        `SELECT count(*) FROM legacy.id_map m
         JOIN ledger_entries e ON e.id = m.old_id AND e.kind = 'expense'
         WHERE m.new_model = 'SupersededBillPurchase'`,
      ),
    ).toBe("0");
    const purchaseCounts = query(
      CASE,
      `SELECT
         (SELECT count(*) FROM legacy.bill_transactions bt
           WHERE NOT EXISTS (
             SELECT 1 FROM legacy.id_map m
             WHERE m.old_id = bt.id AND m.old_model = 'BillTransaction' AND m.new_model = 'SupersededBillPurchase'
           ))::text,
         (SELECT count(*) FROM ledger_entries e
           JOIN legacy.id_map m ON m.new_id = e.id AND m.old_model = 'BillTransaction' AND m.new_model = 'LedgerEntry')::text`,
    );
    expect(purchaseCounts[0]?.[0]).toBe(purchaseCounts[0]?.[1]);
    expect(purchaseCounts[0]?.[0]).not.toBe("0");
  });
});
