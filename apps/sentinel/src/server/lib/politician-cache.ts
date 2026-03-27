import { prisma } from "./prisma";

let cpfCache: Map<string, string> | null = null;
let cpfCacheTime = 0;

let seqToCpfCache: Map<string, string> | null = null;
let seqCacheTime = 0;

const TTL = 5 * 60 * 1000;

export async function getCpfToPoliticianId(): Promise<Map<string, string>> {
  if (cpfCache && Date.now() - cpfCacheTime < TTL) return cpfCache;
  const rows = await prisma.politician.findMany({
    select: { id: true, cpf: true },
  });
  cpfCache = new Map(rows.map((r) => [r.cpf, r.id]));
  cpfCacheTime = Date.now();
  return cpfCache;
}

export function invalidatePoliticianCache() {
  cpfCache = null;
  cpfCacheTime = 0;
}

export async function getSeqToCpfMap(): Promise<Map<string, string>> {
  if (seqToCpfCache && Date.now() - seqCacheTime < TTL) return seqToCpfCache;

  const rows = await prisma.$queryRawUnsafe<{ seq: string; cpf: string }[]>(`
    SELECT
      data->>'SQ_CANDIDATO' as seq,
      data->>'NR_CPF_CANDIDATO' as cpf
    FROM raw_records
    WHERE source = 'TSE' AND "recordType" = 'candidate'
      AND data->>'SQ_CANDIDATO' IS NOT NULL
      AND data->>'NR_CPF_CANDIDATO' IS NOT NULL
  `);

  const { cleanCpf } = await import("@/lib/gov-apis/tse");

  seqToCpfCache = new Map<string, string>();
  for (const row of rows) {
    if (row.seq && row.cpf) {
      seqToCpfCache.set(row.seq, cleanCpf(row.cpf));
    }
  }
  seqCacheTime = Date.now();
  return seqToCpfCache;
}
