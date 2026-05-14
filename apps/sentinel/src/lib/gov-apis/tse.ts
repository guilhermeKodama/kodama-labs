import { createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as readline from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";

const BASE_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele";

const CANDIDATE_URL = (year: number) =>
  `${BASE_URL}/consulta_cand/consulta_cand_${year}.zip`;

const DONATIONS_URL = (year: number) =>
  `${BASE_URL}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_${year}.zip`;

const ASSETS_URL = (year: number) =>
  `${BASE_URL}/bem_candidato/bem_candidato_${year}.zip`;

export type TseRawRow = Record<string, string>;

async function fetchAndUnzipCsv(
  url: string,
  filePattern: RegExp,
): Promise<string[]> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000);

    try {
      console.log(`[tse] Downloading ${url} (attempt ${attempt}/${maxRetries})...`);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)" },
      });

      if (!res.ok) {
        throw new Error(`TSE download failed: ${res.status} ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log(`[tse] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB from ${url}`);

      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      const csvTexts: string[] = [];

      for (const entry of entries) {
        if (filePattern.test(entry.entryName) && !entry.isDirectory) {
          const raw = entry.getData();
          const text = new TextDecoder("latin1").decode(raw);
          csvTexts.push(text);
        }
      }

      return csvTexts;
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tse] Attempt ${attempt} failed for ${url}: ${msg}`);
      if (attempt === maxRetries) throw err;
      const delay = attempt * 10_000;
      console.log(`[tse] Retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unreachable");
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ";" && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function cleanCpf(cpf: string): string {
  return cpf.replace(/\D/g, "").replace(/^0+/, "").padStart(11, "0");
}

function csvToRecords(csvText: string): TseRawRow[] {
  const lines = csvText.split("\n");
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!);
  const records: TseRawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const cols = parseCsvLine(line);
    const row: TseRawRow = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = cols[j] ?? "";
    }
    records.push(row);
  }

  return records;
}

export async function fetchTseCandidates(year: number): Promise<TseRawRow[]> {
  console.log(`[tse] Downloading candidates for ${year}...`);
  const csvTexts = await fetchAndUnzipCsv(
    CANDIDATE_URL(year),
    /consulta_cand.*\.csv$/i,
  );

  let rows: TseRawRow[] = [];
  for (const csvText of csvTexts) {
    rows = rows.concat(csvToRecords(csvText));
  }

  console.log(`[tse] Parsed ${rows.length} candidate rows for ${year}`);
  return rows;
}

export async function fetchTseDonations(year: number): Promise<TseRawRow[]> {
  console.log(`[tse] Downloading donations for ${year}...`);
  const csvTexts = await fetchAndUnzipCsv(
    DONATIONS_URL(year),
    /receitas_candidatos.*\.csv$/i,
  );

  let rows: TseRawRow[] = [];
  for (const csvText of csvTexts) {
    rows = rows.concat(csvToRecords(csvText));
  }

  console.log(`[tse] Parsed ${rows.length} donation rows for ${year}`);
  return rows;
}

export async function fetchTseAssets(year: number): Promise<TseRawRow[]> {
  console.log(`[tse] Downloading assets for ${year}...`);
  const csvTexts = await fetchAndUnzipCsv(
    ASSETS_URL(year),
    /bem_candidato.*\.csv$/i,
  );

  let rows: TseRawRow[] = [];
  for (const csvText of csvTexts) {
    rows = rows.concat(csvToRecords(csvText));
  }

  console.log(`[tse] Parsed ${rows.length} asset rows for ${year}`);
  return rows;
}

// ============================================
// Streaming variants — process row-by-row without buffering
// the full annual CSV in memory. Caller's `onRow` may throw
// to abort early (e.g. budget exhausted); the exception
// propagates back through the awaited call.
// ============================================

async function downloadToTmp(url: string): Promise<string> {
  const tmpPath = join(tmpdir(), `tse-${randomUUID()}.zip`);
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000);

    try {
      console.log(`[tse] Streaming ${url} (attempt ${attempt}/${maxRetries})...`);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)" },
      });

      if (!res.ok) {
        throw new Error(`TSE download failed: ${res.status} ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error(`No response body for ${url}`);
      }

      await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmpPath));

      const stats = await fs.stat(tmpPath);
      console.log(`[tse] Downloaded ${(stats.size / 1024 / 1024).toFixed(1)}MB to ${tmpPath}`);

      return tmpPath;
    } catch (err) {
      clearTimeout(timeout);
      await fs.unlink(tmpPath).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tse] Attempt ${attempt} failed for ${url}: ${msg}`);
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 10_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unreachable");
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("yauzl.open returned no zip"));
      resolve(zip);
    });
  });
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("openReadStream returned no stream"));
      resolve(stream);
    });
  });
}

async function streamCsvFromZip(
  zipPath: string,
  filePattern: RegExp,
  onRow: (row: TseRawRow) => Promise<void> | void,
): Promise<void> {
  const zip = await openZip(zipPath);

  try {
    while (true) {
      const next = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const onEntry = (entry: yauzl.Entry) => {
          zip.removeListener("end", onEnd);
          zip.removeListener("error", onError);
          resolve(entry);
        };
        const onEnd = () => {
          zip.removeListener("entry", onEntry);
          zip.removeListener("error", onError);
          resolve(null);
        };
        const onError = (err: Error) => {
          zip.removeListener("entry", onEntry);
          zip.removeListener("end", onEnd);
          reject(err);
        };
        zip.once("entry", onEntry);
        zip.once("end", onEnd);
        zip.once("error", onError);
        zip.readEntry();
      });

      if (!next) break;

      const isDirectory = /\/$/.test(next.fileName);
      if (isDirectory || !filePattern.test(next.fileName)) {
        continue;
      }

      const stream = await openEntryStream(zip, next);
      stream.setEncoding("latin1");
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let header: string[] | null = null;
      try {
        for await (const rawLine of rl) {
          const line = rawLine.trim();
          if (!line) continue;
          const cols = parseCsvLine(line);
          if (!header) {
            header = cols;
            continue;
          }
          const row: TseRawRow = {};
          for (let j = 0; j < header.length; j++) {
            row[header[j]!] = cols[j] ?? "";
          }
          await onRow(row);
        }
      } finally {
        rl.close();
        const maybeDestroy = (stream as unknown as { destroy?: (err?: Error) => void }).destroy;
        if (typeof maybeDestroy === "function") {
          maybeDestroy.call(stream);
        }
      }
    }
  } finally {
    zip.close();
  }
}

async function streamTseCsv(
  url: string,
  filePattern: RegExp,
  onRow: (row: TseRawRow) => Promise<void> | void,
): Promise<void> {
  const tmpPath = await downloadToTmp(url);
  try {
    await streamCsvFromZip(tmpPath, filePattern, onRow);
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

export async function streamTseCandidates(
  year: number,
  onRow: (row: TseRawRow) => Promise<void> | void,
): Promise<void> {
  console.log(`[tse] Streaming candidates for ${year}...`);
  await streamTseCsv(CANDIDATE_URL(year), /consulta_cand.*\.csv$/i, onRow);
}

export async function streamTseDonations(
  year: number,
  onRow: (row: TseRawRow) => Promise<void> | void,
): Promise<void> {
  console.log(`[tse] Streaming donations for ${year}...`);
  await streamTseCsv(DONATIONS_URL(year), /receitas_candidatos.*\.csv$/i, onRow);
}

export async function streamTseAssets(
  year: number,
  onRow: (row: TseRawRow) => Promise<void> | void,
): Promise<void> {
  console.log(`[tse] Streaming assets for ${year}...`);
  await streamTseCsv(ASSETS_URL(year), /bem_candidato.*\.csv$/i, onRow);
}
