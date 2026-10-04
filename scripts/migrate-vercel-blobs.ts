/**
 * One-off copy of Vercel Blob objects onto the local disk layout
 * `packages/storage` already uses, then rewrite DB references to
 * `{APP_URL}/api/blob/{key}`.
 *
 * Dry-run unless `--apply` is passed. Never deletes the remote object.
 * Safe to re-run: rows whose URL is already local are skipped, and a
 * file that is already on disk is not downloaded again.
 *
 * A failed row stays on its Vercel URL, so the next page would select it
 * again. `--after <id>` (exclusive, ordered by id) skips that page.
 * The run prints failed ids and the resume id.
 *
 * Run inside the app container. The process cwd is the app directory;
 * the Prisma client path is resolved from this file, not from cwd.
 *
 *   pnpm exec tsx /repo/scripts/migrate-vercel-blobs.ts --app capital
 *   pnpm exec tsx /repo/scripts/migrate-vercel-blobs.ts --app capital --apply --limit 100
 *   pnpm exec tsx /repo/scripts/migrate-vercel-blobs.ts --app capital --apply --limit 100 --after <id>
 *
 * Required env (already set on the compose services):
 *   DATABASE_URL
 *   NEXT_PUBLIC_APP_URL          (or pass --app-url)
 *   CAPITAL_BLOB_DIR / CAREERS_BLOB_DIR / SENTINEL_BLOB_DIR
 *     (or pass --blob-dir)
 *
 * Optional: BLOB_READ_WRITE_TOKEN is sent only as a Bearer header on GET
 * when a public fetch would fail. It is never used to delete.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isVercelBlobUrl,
  rewriteBlobReference,
  localBlobFilePath,
} from "../packages/storage/src/paths.ts";

export type AppName = "capital" | "careers" | "sentinel";

export type TableSpec = {
  name: string;
  model: string;
  urlField: string;
  pathnameField: string | null;
  /** Null when the model has no mime column (careers GeneratedDocument). */
  contentTypeField: string | null;
};

export const TABLES: Record<AppName, TableSpec[]> = {
  capital: [
    {
      name: "attachments",
      model: "attachment",
      urlField: "blobUrl",
      pathnameField: "pathname",
      contentTypeField: "mimeType",
    },
    {
      name: "conversation_files",
      model: "conversationFile",
      urlField: "blobUrl",
      pathnameField: "pathname",
      contentTypeField: "mimeType",
    },
  ],
  careers: [
    {
      name: "ResumeVersion",
      model: "resumeVersion",
      urlField: "blobUrl",
      pathnameField: "pathname",
      contentTypeField: "mimeType",
    },
    {
      name: "ContextDocument",
      model: "contextDocument",
      urlField: "blobUrl",
      pathnameField: "pathname",
      contentTypeField: "mimeType",
    },
    {
      name: "GeneratedDocument",
      model: "generatedDocument",
      urlField: "blobUrl",
      pathnameField: "pathname",
      contentTypeField: null,
    },
  ],
  sentinel: [
    {
      name: "procurement_documents",
      model: "procurementDocument",
      urlField: "storageKey",
      pathnameField: null,
      contentTypeField: "mimeType",
    },
    {
      name: "contract_documents",
      model: "contractDocument",
      urlField: "storageKey",
      pathnameField: null,
      contentTypeField: "mimeType",
    },
  ],
};

const BLOB_DIR_ENV: Record<AppName, string> = {
  capital: "CAPITAL_BLOB_DIR",
  careers: "CAREERS_BLOB_DIR",
  sentinel: "SENTINEL_BLOB_DIR",
};

export type Counts = {
  table: string;
  pending: number;
  selected: number;
  migrated: number;
  reusedFile: number;
  downloaded: number;
  failed: number;
  failedIds: string[];
  resumeAfter: string | null;
};

type Delegate = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    take?: number;
    orderBy: { id: "asc" };
    select: Record<string, boolean>;
  }): Promise<Array<Record<string, unknown>>>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
};

type PrismaLike = Record<string, Delegate> & {
  $disconnect(): Promise<void>;
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  rawRecord: {
    update(args: { where: { id: string }; data: { data: unknown } }): Promise<unknown>;
  };
};

export type BatchRow = { id: string; ok: boolean };

/** Exclusive id cursor. Rows at or before `after` are not selected. */
export function batchWhere(
  urlField: string,
  after: string | undefined,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    [urlField]: { contains: "blob.vercel-storage.com" },
  };
  if (after) where.id = { gt: after };
  return where;
}

export function summarizeBatch(rows: BatchRow[]): {
  failedIds: string[];
  resumeAfter: string | null;
} {
  return {
    failedIds: rows.filter((row) => !row.ok).map((row) => row.id),
    resumeAfter: rows.length > 0 ? rows[rows.length - 1]!.id : null,
  };
}

/** Prisma client entry next to this repo, independent of process.cwd(). */
export function prismaClientEntry(scriptFile: string, app: AppName): string {
  return path.resolve(
    path.dirname(scriptFile),
    "..",
    "apps",
    app,
    "src",
    "generated",
    "prisma",
    "index.js",
  );
}

/**
 * Write `body` via a temp file in the same directory, then rename.
 * When `contentLengthHeader` is present it must match `body.length`.
 * A mismatch throws before the final path exists.
 */
export async function writeBlobFile(
  filePath: string,
  body: Buffer,
  contentLengthHeader: string | null,
): Promise<void> {
  if (contentLengthHeader != null && contentLengthHeader !== "") {
    const expected = Number(contentLengthHeader);
    if (!Number.isInteger(expected) || expected < 0 || expected !== body.length) {
      throw new Error(
        `content-length ${contentLengthHeader} does not match downloaded size ${body.length}`,
      );
    }
  }
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.partial`,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(tmp, body);
    await rename(tmp, filePath);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(): {
  app: AppName;
  apply: boolean;
  limit: number;
  after: string | undefined;
  appUrl: string;
  blobDir: string;
} {
  const app = argValue("--app");
  if (app !== "capital" && app !== "careers" && app !== "sentinel") {
    throw new Error("--app must be capital, careers, or sentinel");
  }
  const limitRaw = argValue("--limit");
  const limit = limitRaw === undefined ? 100 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("--limit must be a non-negative integer (0 means no cap)");
  }
  const appUrl = argValue("--app-url") ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("Set NEXT_PUBLIC_APP_URL or pass --app-url");
  }
  const blobDir = argValue("--blob-dir") ?? process.env[BLOB_DIR_ENV[app]];
  if (!blobDir) {
    throw new Error(`Set ${BLOB_DIR_ENV[app]} or pass --blob-dir`);
  }
  return {
    app,
    apply: process.argv.includes("--apply"),
    limit,
    after: argValue("--after"),
    appUrl,
    blobDir,
  };
}

async function loadPrisma(app: AppName): Promise<PrismaLike> {
  const entry = prismaClientEntry(fileURLToPath(import.meta.url), app);
  const mod = (await import(pathToFileURL(entry).href)) as {
    PrismaClient: new () => PrismaLike;
  };
  return new mod.PrismaClient();
}

function emptyCounts(table: string): Counts {
  return {
    table,
    pending: 0,
    selected: 0,
    migrated: 0,
    reusedFile: 0,
    downloaded: 0,
    failed: 0,
    failedIds: [],
    resumeAfter: null,
  };
}

function selectFor(table: TableSpec): Record<string, boolean> {
  const select: Record<string, boolean> = { id: true, [table.urlField]: true };
  if (table.pathnameField) select[table.pathnameField] = true;
  if (table.contentTypeField) select[table.contentTypeField] = true;
  return select;
}

function contentTypeOf(row: Record<string, unknown>, field: string | null): string {
  if (!field) return "";
  const value = row[field];
  return typeof value === "string" ? value : "";
}

async function materialize(options: {
  url: string;
  key: string;
  blobDir: string;
  contentType: string;
  apply: boolean;
  counts: Counts;
  rowId: string;
}): Promise<boolean> {
  let filePath: string;
  try {
    filePath = localBlobFilePath(options.blobDir, options.key);
  } catch (error) {
    options.counts.failed += 1;
    options.counts.failedIds.push(options.rowId);
    console.error(`[fail] unsafe key for ${options.url}:`, error);
    return false;
  }

  let exists = false;
  try {
    await stat(filePath);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    options.counts.reusedFile += 1;
    return true;
  }

  if (!options.apply) return true;

  const headers: Record<string, string> = {};
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(options.url, { headers });
  } catch (error) {
    options.counts.failed += 1;
    options.counts.failedIds.push(options.rowId);
    console.error(`[fail] download ${options.url}:`, error);
    return false;
  }
  if (!response.ok) {
    options.counts.failed += 1;
    options.counts.failedIds.push(options.rowId);
    console.error(`[fail] download ${options.url}: HTTP ${response.status}`);
    return false;
  }

  const body = Buffer.from(await response.arrayBuffer());
  const contentType =
    options.contentType ||
    response.headers.get("content-type") ||
    "application/octet-stream";
  try {
    await writeBlobFile(filePath, body, response.headers.get("content-length"));
  } catch (error) {
    options.counts.failed += 1;
    options.counts.failedIds.push(options.rowId);
    console.error(`[fail] write ${options.url}:`, error);
    return false;
  }
  const metaPath = `${filePath}.meta.json`;
  let metaExists = false;
  try {
    await readFile(metaPath, "utf8");
    metaExists = true;
  } catch {
    metaExists = false;
  }
  if (!metaExists) {
    await writeBlobFile(metaPath, Buffer.from(JSON.stringify({ contentType })), null);
  }
  options.counts.downloaded += 1;
  return true;
}

async function migrateTable(
  prisma: PrismaLike,
  table: TableSpec,
  options: {
    apply: boolean;
    limit: number;
    after: string | undefined;
    appUrl: string;
    blobDir: string;
  },
): Promise<Counts> {
  const counts = emptyCounts(table.name);
  const where = batchWhere(table.urlField, options.after);
  const delegate = prisma[table.model];
  if (!delegate) throw new Error(`Prisma model ${table.model} is missing`);

  counts.pending = await delegate.count({
    where: batchWhere(table.urlField, undefined),
  });
  const rows = await delegate.findMany({
    where,
    orderBy: { id: "asc" },
    ...(options.limit > 0 ? { take: options.limit } : {}),
    select: selectFor(table),
  });
  counts.selected = rows.length;
  const outcomes: BatchRow[] = [];

  for (const row of rows) {
    const id = String(row.id);
    const url = row[table.urlField];
    if (typeof url !== "string" || !isVercelBlobUrl(url)) {
      outcomes.push({ id, ok: true });
      continue;
    }
    const pathname =
      table.pathnameField && typeof row[table.pathnameField] === "string"
        ? (row[table.pathnameField] as string)
        : null;
    let rewritten: { key: string; localUrl: string };
    try {
      rewritten = rewriteBlobReference(url, options.appUrl, pathname);
    } catch (error) {
      counts.failed += 1;
      counts.failedIds.push(id);
      outcomes.push({ id, ok: false });
      console.error(`[fail] ${table.name} ${id}:`, error);
      continue;
    }

    const ok = await materialize({
      url,
      key: rewritten.key,
      blobDir: options.blobDir,
      contentType: contentTypeOf(row, table.contentTypeField),
      apply: options.apply,
      counts,
      rowId: id,
    });
    if (!ok) {
      outcomes.push({ id, ok: false });
      continue;
    }

    if (options.apply) {
      const data: Record<string, unknown> = { [table.urlField]: rewritten.localUrl };
      if (table.pathnameField) data[table.pathnameField] = rewritten.key;
      await delegate.update({ where: { id }, data });
    }
    counts.migrated += 1;
    outcomes.push({ id, ok: true });
  }

  const summary = summarizeBatch(outcomes);
  counts.resumeAfter = summary.resumeAfter;
  return counts;
}

async function migrateRawRecords(
  prisma: PrismaLike,
  options: {
    apply: boolean;
    limit: number;
    after: string | undefined;
    appUrl: string;
    blobDir: string;
  },
): Promise<Counts> {
  const counts = emptyCounts("raw_records._blobUrl");
  const after = options.after ?? "";
  const pending = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count
    FROM raw_records
    WHERE data->>'_blobUrl' LIKE '%blob.vercel-storage.com%'
  `;
  counts.pending = pending[0]?.count ?? 0;

  const rows =
    options.limit > 0
      ? await prisma.$queryRaw<Array<{ id: string; data: Record<string, unknown> }>>`
          SELECT id, data
          FROM raw_records
          WHERE data->>'_blobUrl' LIKE '%blob.vercel-storage.com%'
            AND (${after} = '' OR id > ${after})
          ORDER BY id
          LIMIT ${options.limit}
        `
      : await prisma.$queryRaw<Array<{ id: string; data: Record<string, unknown> }>>`
          SELECT id, data
          FROM raw_records
          WHERE data->>'_blobUrl' LIKE '%blob.vercel-storage.com%'
            AND (${after} = '' OR id > ${after})
          ORDER BY id
        `;
  counts.selected = rows.length;
  const outcomes: BatchRow[] = [];

  for (const row of rows) {
    const data = row.data;
    const url = data._blobUrl;
    if (typeof url !== "string" || !isVercelBlobUrl(url)) {
      outcomes.push({ id: row.id, ok: true });
      continue;
    }
    const pathname = typeof data._blobPathname === "string" ? data._blobPathname : null;
    let rewritten: { key: string; localUrl: string };
    try {
      rewritten = rewriteBlobReference(url, options.appUrl, pathname);
    } catch (error) {
      counts.failed += 1;
      counts.failedIds.push(row.id);
      outcomes.push({ id: row.id, ok: false });
      console.error(`[fail] raw_records ${row.id}:`, error);
      continue;
    }
    const mime = typeof data._mimeType === "string" ? data._mimeType : "";
    const ok = await materialize({
      url,
      key: rewritten.key,
      blobDir: options.blobDir,
      contentType: mime,
      apply: options.apply,
      counts,
      rowId: row.id,
    });
    if (!ok) {
      outcomes.push({ id: row.id, ok: false });
      continue;
    }
    if (options.apply) {
      await prisma.rawRecord.update({
        where: { id: row.id },
        data: {
          data: {
            ...data,
            _blobUrl: rewritten.localUrl,
            _blobPathname: rewritten.key,
          },
        },
      });
    }
    counts.migrated += 1;
    outcomes.push({ id: row.id, ok: true });
  }

  counts.resumeAfter = summarizeBatch(outcomes).resumeAfter;
  return counts;
}

function printCounts(counts: Counts): void {
  console.log(
    `${counts.table}: pending=${counts.pending} selected=${counts.selected} migrated=${counts.migrated} reused=${counts.reusedFile} downloaded=${counts.downloaded} failed=${counts.failed}`,
  );
  if (counts.resumeAfter) {
    console.log(`${counts.table}: resume --after ${counts.resumeAfter}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  console.log(
    `${options.apply ? "apply" : "dry-run"} app=${options.app} limit=${options.limit === 0 ? "none" : options.limit} after=${options.after ?? ""} blobDir=${options.blobDir} appUrl=${options.appUrl}`,
  );
  const prisma = await loadPrisma(options.app);
  let failed = 0;
  const failedIds: string[] = [];
  try {
    for (const table of TABLES[options.app]) {
      const counts = await migrateTable(prisma, table, options);
      printCounts(counts);
      failed += counts.failed;
      failedIds.push(...counts.failedIds);
    }
    if (options.app === "sentinel") {
      const counts = await migrateRawRecords(prisma, options);
      printCounts(counts);
      failed += counts.failed;
      failedIds.push(...counts.failedIds);
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(
    failedIds.length > 0 ? `failed ids: ${failedIds.join(", ")}` : "failed ids: none",
  );
  if (failed > 0) process.exitCode = 1;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
