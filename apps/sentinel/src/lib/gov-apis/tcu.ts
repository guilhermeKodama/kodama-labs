const CSV_BASE =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos";

export interface TcuInidoneo {
  cpfCnpj: string;
  nome: string;
  processo: string;
  deliberacao: string;
  dataTransitoJulgado: string;
  dataFinal: string | null;
  dataAcordao: string;
  uf: string;
  municipio: string;
}

export interface TcuInabilitado {
  cpfCnpj: string;
  nome: string;
  processo: string;
  deliberacao: string;
  dataTransitoJulgado: string;
  dataFinal: string | null;
  dataAcordao: string;
  uf: string;
  municipio: string;
}

function parsePipeSeparatedCsv<T>(
  csvText: string,
  mapRow: (values: string[]) => T
): T[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const results: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split("|").map((v) => v.replace(/^"|"$/g, "").trim());
    results.push(mapRow(values));
  }
  return results;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTcuCsv(filename: string): Promise<string> {
  const url = `${CSV_BASE}/${filename}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`TCU CSV download error: ${response.status} for ${url}`);
      }
      return response.text();
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries) throw err;
      await sleep(attempt * 5000);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unreachable");
}

export async function fetchInidoneos(): Promise<TcuInidoneo[]> {
  const csv = await fetchTcuCsv("licitantes-inidoneos.csv");
  return parsePipeSeparatedCsv(csv, (v) => ({
    nome: v[0] ?? "",
    cpfCnpj: v[1] ?? "",
    processo: v[2] ?? "",
    deliberacao: v[3] ?? "",
    dataTransitoJulgado: v[4] ?? "",
    dataFinal: v[5] || null,
    dataAcordao: v[6] ?? "",
    uf: v[7] ?? "",
    municipio: v[8] ?? "",
  }));
}

export async function fetchInabilitados(): Promise<TcuInabilitado[]> {
  const csv = await fetchTcuCsv("inabilitados-funcao-publica.csv");
  return parsePipeSeparatedCsv(csv, (v) => ({
    nome: v[0] ?? "",
    cpfCnpj: v[1] ?? "",
    processo: v[2] ?? "",
    deliberacao: v[3] ?? "",
    dataTransitoJulgado: v[4] ?? "",
    dataFinal: v[5] || null,
    dataAcordao: v[6] ?? "",
    uf: v[7] ?? "",
    municipio: v[8] ?? "",
  }));
}
