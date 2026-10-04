/**
 * One-off copy of Vercel Blob objects onto the local disk layout
 * `packages/storage` already uses, then rewrite DB references to
 * `{APP_URL}/api/blob/{key}`.
 *
 * Dry-run unless `--apply` is passed. Never deletes the remote object.
 * Safe to re-run: rows whose URL is already local are skipped, and a
 * file that is already on disk is not downloaded again.
 *
 * Run inside the app container (the image contains this repo and the
 * generated Prisma client):
 *
 *   pnpm exec tsx /repo/scripts/migrate-vercel-blobs.ts --app capital
 *   pnpm exec tsx /repo/scripts/migrate-vercel-blobs.ts --app capital --apply --limit 100
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
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isVercelBlobUrl,
  rewriteBlobReference,
  localBlobFilePath,
} from "../packages/storage/src/paths.ts";

type AppName = "capital" | "careers" | "sentinel";

type TableSpec = {
  name: string;
  model: string;
  urlField: string;
  pathnameField: string | null;
};

const TABLES: Record<AppName, TableSpec[]> = {
  capital: [
    { name: "attachments", model: "attachment", urlField: "blobUrl", pathnameField: "pathname" },
    {
      name: "conversation_files",
      model: "conversationFile",
      urlField: "blobUrl",
      pathnameField: "pathname",
    },
  ],
  careers: [
    { name: "ResumeVersion", model: "resumeVersion", urlField: "blobUrl", pathnameField: "pathname" },
    {
      name: "ContextDocument",
      model: "contextDocument",
      urlField: "blobUrl",
      pathnameField: "pathname",
    },
    {
      name: "GeneratedDocument",
      model: "generatedDocument",
      urlField: "blobUrl",
      pathnameField: "pathname",
    },
  ],
  sentinel: [
    {
      name: "procurement_documents",
      model: "procurementDocument",
      urlField: "storageKey",
      pathnameField: null,
    },
    {
      name: "contract_documents",
      model: "contractDocument",
      urlField: "storageKey",
      pathnameField: null,
    },
  ],
};

const BLOB_DIR_ENV: Record<AppName, string> = {
  capital: "CAPITAL_BLOB_DIR",
  careers: "CAREERS_BLOB_DIR",
  sentinel: "SENTINEL_BLOB_DIR",
};

type Counts = {
  table: string;
  pending: number;
  selected: number;
  migrated: number;
  reusedFile: number;
  downloaded: number;
  failed: number;
};

type Delegate = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    take?: number;
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
  return { app, apply: process.argv.includes("--apply"), limit, appUrl, blobDir };
}

async function loadPrisma(app: AppName): Promise<PrismaLike> {
  const entry = path.resolve(`apps/${app}/src/generated/prisma/index.js`);
  const mod = (await import(pathToFileURL(entry).href)) as { PrismaClient: new () => PrismaLike };
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
  };
}

async function materialize(options: {
  url: string;
  key: string;
  blobDir: string;
  contentType: string;
  apply: boolean;
  counts: Counts;
}): Promise<boolean> {
  let filePath: string;
  try {
    filePath = localBlobFilePath(options.blobDir, options.key);
  } catch (error) {
    options.counts.failed += 1;
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
    console.error(`[fail] download ${options.url}:`, error);
    return false;
  }
  if (!response.ok) {
    options.counts.failed += 1;
    console.error(`[fail] download ${options.url}: HTTP ${response.status}`);
    return false;
  }

  const body = Buffer.from(await response.arrayBuffer());
  const contentType =
    options.contentType ||
    response.headers.get("content-type") ||
    "application/octet-stream";
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  const metaPath = `${filePath}.meta.json`;
  let metaExists = false;
  try {
    await readFile(metaPath, "utf8");
    metaExists = true;
  } catch {
    metaExists = false;
  }
  if (!metaExists) {
    await writeFile(metaPath, JSON.stringify({ contentType }));
  }
  options.counts.downloaded += 1;
  return true;
}

async function migrateTable(
  prisma: PrismaLike,
  table: TableSpec,
  options: { apply: boolean; limit: number; appUrl: string; blobDir: string },
): Promise<Counts> {
  const counts = emptyCounts(table.name);
  const where = { [table.urlField]: { contains: "blob.vercel-storage.com" } };
  const delegate = prisma[table.model];
  if (!delegate) throw new Error(`Prisma model ${table.model} is missing`);

  counts.pending = await delegate.count({ where });
  const select: Record<string, boolean> = { id: true, [table.urlField]: true, mimeType: true };
  if (table.pathnameField) select[table.pathnameField] = true;

  const rows = await delegate.findMany({
    where,
    ...(options.limit > 0 ? { take: options.limit } : {}),
    select,
  });
  counts.selected = rows.length;

  for (const row of rows) {
    const url = row[table.urlField];
    if (typeof url !== "string" || !isVercelBlobUrl(url)) continue;
    const pathname =
      table.pathnameField && typeof row[table.pathnameField] === "string"
        ? (row[table.pathnameField] as string)
        : null;
    let rewritten: { key: string; localUrl: string };
    try {
      rewritten = rewriteBlobReference(url, options.appUrl, pathname);
    } catch (error) {
      counts.failed += 1;
      console.error(`[fail] ${table.name} ${String(row.id)}:`, error);
      continue;
    }

    const ok = await materialize({
      url,
      key: rewritten.key,
      blobDir: options.blobDir,
      contentType: typeof row.mimeType === "string" ? row.mimeType : "",
      apply: options.apply,
      counts,
    });
    if (!ok) continue;

    if (options.apply) {
      const data: Record<string, unknown> = { [table.urlField]: rewritten.localUrl };
      if (table.pathnameField) data[table.pathnameField] = rewritten.key;
      await delegate.update({ where: { id: String(row.id) }, data });
    }
    counts.migrated += 1;
  }

  return counts;
}

async function migrateRawRecords(
  prisma: PrismaLike,
  options: { apply: boolean; limit: number; appUrl: string; blobDir: string },
): Promise<Counts> {
  const counts = emptyCounts("raw_records._blobUrl");
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
          LIMIT ${options.limit}
        `
      : await prisma.$queryRaw<Array<{ id: string; data: Record<string, unknown> }>>`
          SELECT id, data
          FROM raw_records
          WHERE data->>'_blobUrl' LIKE '%blob.vercel-storage.com%'
        `;
  counts.selected = rows.length;

  for (const row of rows) {
    const data = row.data;
    const url = data._blobUrl;
    if (typeof url !== "string" || !isVercelBlobUrl(url)) continue;
    const pathname = typeof data._blobPathname === "string" ? data._blobPathname : null;
    let rewritten: { key: string; localUrl: string };
    try {
      rewritten = rewriteBlobReference(url, options.appUrl, pathname);
    } catch (error) {
      counts.failed += 1;
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
    });
    if (!ok) continue;
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
  }

  return counts;
}

function printCounts(counts: Counts): void {
  console.log(
    `${counts.table}: pending=${counts.pending} selected=${counts.selected} migrated=${counts.migrated} reused=${counts.reusedFile} downloaded=${counts.downloaded} failed=${counts.failed}`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs();
  console.log(
    `${options.apply ? "apply" : "dry-run"} app=${options.app} limit=${options.limit === 0 ? "none" : options.limit} blobDir=${options.blobDir} appUrl=${options.appUrl}`,
  );
  const prisma = await loadPrisma(options.app);
  let failed = 0;
  try {
    for (const table of TABLES[options.app]) {
      const counts = await migrateTable(prisma, table, options);
      printCounts(counts);
      failed += counts.failed;
    }
    if (options.app === "sentinel") {
      const counts = await migrateRawRecords(prisma, options);
      printCounts(counts);
      failed += counts.failed;
    }
  } finally {
    await prisma.$disconnect();
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
