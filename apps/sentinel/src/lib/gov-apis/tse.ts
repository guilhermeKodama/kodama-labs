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
