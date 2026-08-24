/**
 * One-time (re-runnable) importer: reads the Obsidian vault's `vagas/`
 * folder and populates the careers database. Everything is upsert-by-
 * natural-key, so this can be run again after fixing a parsing bug without
 * duplicating anything. Reads only — never writes back to the vault.
 *
 * Usage: pnpm import:vault [-- --dry-run] [-- --vault <path>]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import matter from "gray-matter";
import yaml from "js-yaml";
import { prisma } from "../server/lib/prisma";
import { env } from "../env";
import { slugify } from "../server/ingest/text-normalize";
import { markdownToTiptapDoc, tiptapDocToText } from "./markdown-to-tiptap";
import atsDict from "./ats-dict.json";
import type { PrismaClient, Prisma } from "../generated/prisma";

// Every helper below takes `db` as its first argument instead of importing
// the `prisma` singleton directly. That's what makes --dry-run honest: the
// entry point passes either the real client or a `$transaction` callback's
// `tx` handle that gets rolled back at the end — the exact same code path
// runs either way, so a dry run actually validates the whole import instead
// of a parallel "pretend" implementation that could drift from the real one.
type Db = PrismaClient | Prisma.TransactionClient;

type ImportReport = {
  companies: number;
  jobs: number;
  jobsSkipped: { file: string; reason: string }[];
  boardsSeeded: number;
  resumesImported: number;
  contextDocsImported: number;
  warnings: string[];
};

const STATUS_MAP: Record<
  string,
  "RADAR" | "TRIAGEM" | "SHORTLIST" | "APLICADA" | "ENTREVISTA" | "OFERTA" | "CONTRATADA" | "DESCARTADA"
> = {
  "0 - radar": "RADAR",
  "1 - triagem": "TRIAGEM",
  "2 - shortlist": "SHORTLIST",
  "3 - aplicada": "APLICADA",
  "4 - entrevista": "ENTREVISTA",
  "5 - oferta": "OFERTA",
  "6 - contratada": "CONTRATADA",
  "x - descartada": "DESCARTADA",
};

const REJECTION_HEADINGS = [
  "# motivo",
  "## motivo",
  "# razão descarte",
  "# razao descarte",
  "# raciocínio",
  "# raciocinio",
  "## descartada",
  "## desfecho",
];

// ---------------------------------------------------------------------------
// Step 0: copy the vault locally. The CIFS mount is fast, but this is a
// one-way migration reading from a shared NAS that another tool (the cron
// daemon this replaces) can still touch — copying first means the import
// runs against one consistent snapshot instead of a folder that could
// change mid-parse.
// ---------------------------------------------------------------------------
function copyVaultLocally(sourceDir: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "careers-vault-import-"));
  fs.cpSync(sourceDir, dest, { recursive: true });
  return dest;
}

// ---------------------------------------------------------------------------
// _config.yaml -> SearchProfile v1
// ---------------------------------------------------------------------------
type VaultConfig = {
  obrigatorio?: Record<string, unknown>;
  perfil?: Record<string, unknown>;
  preferencias?: Record<string, unknown>;
  fit?: Record<string, unknown>;
  excluir?: Record<string, unknown>;
  operacional?: Record<string, unknown>;
};

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

/**
 * Neutralizes ": " sequences inside multi-line list-item continuations —
 * the vault's _config.yaml has hand-written prose like
 *   - papel de SUPORTE/enablement — o teste NÃO é "..."; é "CONSTRÓI vs OPERA": ❌ operar...
 * where a colon-space inside a plain scalar continuation is a real YAML
 * ambiguity (it looks like the start of a mapping key). Only touches lines
 * that are genuinely continuations of a `- ` bullet, never a real `key:`
 * line, so the rest of the document's structure is untouched.
 */
function sanitizeYamlContinuations(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let inContinuation = false;
  let continuationIndent = 0;

  for (const line of lines) {
    const bulletMatch = /^(\s*)-\s/.exec(line);
    if (bulletMatch) {
      inContinuation = true;
      continuationIndent = bulletMatch[1]!.length;
      out.push(line);
      continue;
    }
    if (inContinuation && line.trim() !== "") {
      const indentLen = line.length - line.trimStart().length;
      const trimmed = line.trimStart();
      if (indentLen > continuationIndent && !trimmed.startsWith("#")) {
        out.push(line.replace(/:\s/g, " - "));
        continue;
      }
      inContinuation = false;
    } else if (line.trim() === "") {
      // blank lines don't end a continuation on their own
    } else {
      inContinuation = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Handles the OTHER common break: a single-line `key: value` where value
 * itself contains an unquoted colon, e.g.
 *   estagio: Pública (NYSE: FSLY)
 * Re-quotes the value with JSON.stringify (a superset-compatible escaping
 * for YAML double-quoted scalars) whenever it contains a colon-space beyond
 * the key's own separator and isn't already quoted/flow/block. Skips
 * anything that looks like a URL (":" immediately followed by "/", not a
 * space) so `fonte: https://...` lines are left alone.
 */
function sanitizeYamlKeyValueLines(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const m = /^(\s*)([\w.-]+):(\s+)(.*)$/.exec(line);
      if (!m) return line;
      const [, indent, key, sep, valueRaw] = m;
      const value = (valueRaw ?? "").trimEnd();
      if (!value) return line;
      if (/^["'[{|>]/.test(value)) return line; // already quoted, flow, or block scalar
      if (!/:\s/.test(value)) return line; // no ambiguous colon in the value
      return `${indent}${key}:${sep}${JSON.stringify(value)}`;
    })
    .join("\n");
}

function sanitizeYaml(raw: string): string {
  return sanitizeYamlContinuations(sanitizeYamlKeyValueLines(raw));
}

function loadYamlWithFallback(raw: string, report: ImportReport, filename: string): unknown {
  try {
    return yaml.load(raw);
  } catch (err) {
    report.warnings.push(
      `${filename}: YAML estrito falhou (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — tentando com sanitização.`
    );
    return yaml.load(sanitizeYaml(raw));
  }
}

/**
 * gray-matter's bundled YAML engine (js-yaml 3.x internally) is exactly as
 * strict as the one above and breaks on the same hand-written frontmatter
 * (e.g. `estagio: Pública (NYSE: FSLY)` in a company file). This swaps in
 * the same strict-then-sanitized-fallback loader as gray-matter's `yaml`
 * engine, so every `matter()` call in this file gets the same resilience
 * `_config.yaml` needed — matter() itself only ever sees the frontmatter
 * block, never the markdown body, so sanitizing here can't touch prose
 * outside the YAML.
 */
function resilientMatter(content: string, report: ImportReport, filename: string): matter.GrayMatterFile<string> {
  return matter(content, {
    engines: {
      yaml: (frontmatter: string) => loadYamlWithFallback(frontmatter, report, filename) as object,
    },
  });
}

async function importSearchProfile(db: Db, vaultDir: string, report: ImportReport): Promise<void> {
  const file = path.join(vaultDir, "_config.yaml");
  if (!fs.existsSync(file)) {
    report.warnings.push("_config.yaml não encontrado — nenhum SearchProfile foi criado.");
    return;
  }
  const config = loadYamlWithFallback(fs.readFileSync(file, "utf8"), report, "_config.yaml") as VaultConfig;
  const obrigatorio = config.obrigatorio ?? {};
  const perfil = config.perfil ?? {};
  const preferencias = config.preferencias ?? {};
  const fit = config.fit ?? {};
  const excluir = config.excluir ?? {};
  const operacional = config.operacional ?? {};

  const initialStatusRaw = String(operacional.status_inicial ?? "1 - Triagem").toLowerCase();

  await db.searchProfile.updateMany({ data: { isActive: false } });
  await db.searchProfile.create({
    data: {
      version: 1,
      isActive: true,
      label: "importado do vault",

      requireRemote: Boolean(obrigatorio.remoto ?? true),
      requirePaysUsd: Boolean(obrigatorio.paga_em_usd ?? true),
      requireHiresBrazil: Boolean(obrigatorio.contrata_no_brasil ?? true),
      contractForms: asStringArray(obrigatorio.formas_contratacao),
      excludePeopleMgmt: !(obrigatorio.people_management === true),
      salaryFloorUsdAnnual: Number(obrigatorio.salario_min_anual_usd ?? 165000),

      track: String(perfil.trilha ?? "IC").toUpperCase() === "MANAGER" ? "MANAGER" : "IC",
      builderOrOperator: String(perfil.papel ?? "builder"),
      targetTitles: asStringArray(perfil.cargos_alvo),
      minSeniority: "SENIOR",
      yearsExperience: Number(perfil.anos_experiencia ?? 13),
      currentTitle: perfil.cargo_atual ? String(perfil.cargo_atual) : null,
      acceptedFormats: asStringArray(perfil.formatos_aceitos),
      coreStack: asStringArray(perfil.stack_principal),
      domains: asStringArray(perfil.dominios),

      wantsEquity: Boolean(preferencias.equity ?? true),
      equityWeight: String(preferencias.equity_peso ?? "alto"),
      salaryTargetUsdAnnual: Number(preferencias.salario_alvo_anual_usd ?? 187000),
      referenceCompanies: asStringArray(preferencias.empresas_referencia),
      preferredSectors: asStringArray(preferencias.setores_preferidos),
      prioritizeYc: Boolean(preferencias.priorizar_ycombinator ?? true),
      bonusCoreInfra: Boolean(preferencias.bonus_empresa_core_infra ?? true),
      desiredStack: asStringArray(preferencias.stack_desejada),
      timezoneBase: String(preferencias.timezone_base ?? "America/Sao_Paulo"),
      minOverlapHours: Number(preferencias.overlap_horas_min ?? 4),
      companySizes: asStringArray(preferencias.tamanho_empresa),
      avoidStack: asStringArray(preferencias.evitar_stack),

      wantToDo: asStringArray(fit.quero_fazer),
      doNotWant: asStringArray(fit.nao_quero),
      desiredCulture: asStringArray(fit.cultura_desejada),

      excludedCompanies: asStringArray(excluir.empresas),
      excludedTitleSubstrs: asStringArray(excluir.titulos_contendo),

      maxJobsPerDay: Number(operacional.max_vagas_por_dia ?? env.MAX_JOBS_PER_DAY),
      initialStatus: STATUS_MAP[initialStatusRaw] ?? "TRIAGEM",
      dedupBy: asStringArray(operacional.dedup_por).length ? asStringArray(operacional.dedup_por) : ["empresa", "cargo"],

      extras: { fontes: operacional.fontes ?? [], watchlist_empresas: operacional.watchlist_empresas ?? null },
    },
  });
}

// ---------------------------------------------------------------------------
// Resumes + context library
// ---------------------------------------------------------------------------
async function importResumes(db: Db, vaultDir: string, report: ImportReport): Promise<void> {
  const inbox = path.join(vaultDir, "_inbox");
  if (!fs.existsSync(inbox)) return;

  const targets: { file: string; label: string }[] = [
    { file: "Guilherme_Kodama_Resume_Systems.md", label: "Systems" },
    { file: "Guilherme_Kodama_Resume_Product.md", label: "Product" },
  ];

  let first = true;
  for (const { file, label } of targets) {
    const full = path.join(inbox, file);
    if (!fs.existsSync(full)) {
      report.warnings.push(`Currículo não encontrado: ${file}`);
      continue;
    }
    const raw = fs.readFileSync(full, "utf8");
    const doc = markdownToTiptapDoc(raw);
    const text = tiptapDocToText(doc);
    // Tiptap's node shape is recursive (TiptapNode[] inside TiptapNode) which
    // Prisma's structural InputJsonValue type can't verify statically even
    // though it's plain JSON at runtime — same cast pattern used anywhere a
    // typed document tree is stored in a Json column.
    const docJson = doc as unknown as Prisma.InputJsonValue;

    await db.resumeVersion.upsert({
      where: { label_version: { label, version: 1 } },
      create: {
        label,
        version: 1,
        originalName: file,
        contentJson: docJson,
        contentText: text,
        isDefault: first,
        notes: "Importado do vault (_inbox/).",
      },
      update: { contentJson: docJson, contentText: text },
    });
    first = false;
    report.resumesImported++;
  }
}

async function importContextDocuments(db: Db, vaultDir: string, report: ImportReport): Promise<void> {
  const items: { file: string; kind: string; title: string }[] = [
    { file: "_key_results.md", kind: "key_results", title: "Key Results — conquistas e ratings" },
    { file: path.join("_notes", "_github_portfolio.md"), kind: "github_portfolio", title: "Portfólio GitHub" },
    { file: path.join("_notes", "_why_railway.md"), kind: "why_company", title: "Por que Railway" },
    { file: path.join("_notes", "_why_nango.md"), kind: "why_company", title: "Por que Nango" },
    { file: path.join("_notes", "_why_supabase.md"), kind: "why_company", title: "Por que Supabase" },
    { file: "_porque-mudar-de-empresa.md", kind: "why_leaving", title: "Por que mudar de empresa" },
  ];

  let order = 0;
  for (const item of items) {
    const full = path.join(vaultDir, item.file);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, "utf8");

    const existing = await db.contextDocument.findFirst({ where: { title: item.title } });
    if (existing) {
      await db.contextDocument.update({ where: { id: existing.id }, data: { bodyText: raw } });
    } else {
      await db.contextDocument.create({ data: { kind: item.kind, title: item.title, bodyText: raw, sortOrder: order } });
    }
    order++;
    report.contextDocsImported++;
  }
}

// ---------------------------------------------------------------------------
// Companies (_empresa-*.md)
// ---------------------------------------------------------------------------
const HEALTH_MAP: Record<string, "FORTE" | "ATENCAO" | "RISCO"> = {
  forte: "FORTE",
  atencao: "ATENCAO",
  atenção: "ATENCAO",
  risco: "RISCO",
};

function parseHealth(raw: unknown): "FORTE" | "ATENCAO" | "RISCO" | "A_CONFIRMAR" {
  const text = String(raw ?? "")
    .replace(/[^\p{L}\s]/gu, "")
    .trim()
    .toLowerCase();
  for (const [key, value] of Object.entries(HEALTH_MAP)) {
    if (text.includes(key)) return value;
  }
  return "A_CONFIRMAR";
}

function parseProfitable(
  raw: unknown
): { value: "SIM" | "PROVAVEL_SIM" | "A_CONFIRMAR" | "PROVAVEL_NAO" | "NAO"; note: string | null } {
  if (raw === undefined || raw === null || raw === "") return { value: "A_CONFIRMAR", note: null };
  const text = String(raw).trim();
  const lower = text.toLowerCase();
  if (lower.startsWith("sim")) return { value: "SIM", note: text };
  if (lower.startsWith("não") || lower.startsWith("nao")) return { value: "NAO", note: text };
  if (lower.startsWith("parcial")) return { value: "PROVAVEL_SIM", note: text };
  return { value: "A_CONFIRMAR", note: text };
}

const INT4_MAX = 2_147_483_647;

/**
 * `funcionarios` is free text like "~7.239" or "~350-390 (Crunchbase) /
 * ~7.239 (LinkedIn)" — stripping non-digits from the LATTER blindly
 * concatenates every number in the string into one, which can overflow
 * Postgres int4. Take only the FIRST digit run instead, and clamp to a
 * sane headcount range.
 */
function parseHeadcount(raw: unknown): number | null {
  if (!raw) return null;
  const match = /(\d[\d.]*)/.exec(String(raw));
  if (!match) return null;
  const n = parseInt(match[1]!.replace(/\./g, ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > INT4_MAX) return null;
  return n;
}

function parseRaisedUsd(raw: unknown): bigint | null {
  if (!raw) return null;
  const text = String(raw);
  const match = /\$?\s?([\d.,]+)\s?(m|b|k)\b/i.exec(text);
  if (!match) return null;
  const num = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const mult = match[2]!.toLowerCase() === "b" ? 1_000_000_000 : match[2]!.toLowerCase() === "m" ? 1_000_000 : 1_000;
  try {
    return BigInt(Math.round(num * mult));
  } catch {
    return null;
  }
}

function extractSection(body: string, headingRegex: RegExp): string | null {
  const match = headingRegex.exec(body);
  if (!match) return null;
  const rest = body.slice(match.index + match[0].length);
  const nextHeading = /^#{1,6}\s/m.exec(rest);
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

function extractSourcesSection(body: string): string[] {
  const section = extractSection(body, /^##\s*Fontes\s*$/im);
  if (!section) return [];
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => {
      const urlMatch = /\((https?:\/\/[^)]+)\)|(\bhttps?:\/\/\S+)/.exec(l);
      return (urlMatch?.[1] ?? urlMatch?.[2] ?? l.replace(/^-\s*/, "")).trim();
    });
}

async function importCompanies(db: Db, vaultDir: string, report: ImportReport): Promise<Map<string, string>> {
  const files = fs
    .readdirSync(vaultDir)
    .filter((f) => f.startsWith("_empresa-") && f.endsWith(".md") && !/ \d+\.md$/.test(f));
  const slugByFile = new Map<string, string>(); // filename slug -> Company.id

  for (const file of files) {
    const fileSlug = file.replace(/^_empresa-/, "").replace(/\.md$/, "");
    const full = path.join(vaultDir, file);
    const { data, content } = resilientMatter(fs.readFileSync(full, "utf8"), report, file);

    const name = String(data.empresa ?? fileSlug);
    const foundedYearRaw = Number(data.fundada);
    const profitable = parseProfitable(data.lucrativa);

    const company = await db.company.upsert({
      where: { slug: fileSlug },
      create: {
        name,
        slug: fileSlug,
        health: parseHealth(data.saude),
        foundedYear: Number.isFinite(foundedYearRaw) && foundedYearRaw >= 1900 && foundedYearRaw <= 2100 ? foundedYearRaw : null,
        headcount: parseHeadcount(data.funcionarios),
        stage: data.estagio ? String(data.estagio) : null,
        totalRaisedRaw: data.total_captado ? String(data.total_captado) : null,
        totalRaisedUsd: parseRaisedUsd(data.total_captado),
        lastRoundRaw: data.ultima_rodada ? String(data.ultima_rodada) : null,
        valuationRaw: data.valuation ? String(data.valuation) : null,
        profitable: profitable.value,
        profitableNote: profitable.note,
        profileUpdatedAt: data.atualizado ? new Date(data.atualizado) : null,
        healthMarkdown: content.trim() || null,
        sources: extractSourcesSection(content),
      },
      update: {
        name,
        health: parseHealth(data.saude),
        healthMarkdown: content.trim() || null,
      },
    });

    slugByFile.set(fileSlug, company.id);

    // Register the display-name slug as an alias too, in case a job file's
    // `empresa:` text slugifies differently from the filename (accents,
    // punctuation, abbreviations) — this is what keeps company resolution
    // from minting a duplicate Company for the same business.
    const nameSlug = slugify(name);
    if (nameSlug !== fileSlug) {
      await db.companyAlias.upsert({
        where: { alias: nameSlug },
        create: { alias: nameSlug, companyId: company.id },
        update: {},
      });
    }

    report.companies++;
  }

  return slugByFile;
}

// ---------------------------------------------------------------------------
// Watchlist + ATS dict -> favorites and CompanyBoard
// ---------------------------------------------------------------------------
type ParsedTable = { headers: string[]; rows: string[][]; sectionHeading: string };

function parseMarkdownTables(body: string): ParsedTable[] {
  const lines = body.split("\n");
  const tables: ParsedTable[] = [];
  let currentHeading = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      currentHeading = headingMatch[1]!.trim();
      i++;
      continue;
    }
    const isSeparator = (l: string | undefined) => !!l && /^\|[\s:|-]+\|?\s*$/.test(l.trim());
    if (line.trim().startsWith("|") && isSeparator(lines[i + 1])) {
      const splitRow = (l: string): string[] => {
        const raw = l.split("|");
        // A well-formed "| a | b | c |" row splits into ["", " a ", " b ", " c ", ""]
        // — drop the empty leading/trailing cells from the outer pipes.
        const trimmedOuter = raw[0]?.trim() === "" && raw[raw.length - 1]?.trim() === "" ? raw.slice(1, -1) : raw;
        return trimmedOuter.map((c) => c.trim());
      };
      const headers = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.trim().startsWith("|")) {
        rows.push(splitRow(lines[j]!));
        j++;
      }
      tables.push({ headers, rows, sectionHeading: currentHeading });
      i = j;
      continue;
    }
    i++;
  }
  return tables;
}

async function importWatchlist(db: Db, vaultDir: string, report: ImportReport, slugByFile: Map<string, string>): Promise<void> {
  const file = path.join(vaultDir, "_watchlist.md");
  if (!fs.existsSync(file)) {
    report.warnings.push("_watchlist.md não encontrado.");
    return;
  }
  const body = fs.readFileSync(file, "utf8");
  const tables = parseMarkdownTables(body);

  for (const table of tables) {
    const col = (name: string) => table.headers.findIndex((h) => h.toLowerCase().startsWith(name.toLowerCase()));
    const idxEmpresa = col("empresa");
    const idxCareers = table.headers.findIndex((h) => /careers|ats/i.test(h));
    const idxPjBr = table.headers.findIndex((h) => /pj-?br/i.test(h));
    const idxPrio = col("prio");
    const idxStack = col("stack");
    if (idxEmpresa === -1) continue;

    for (const row of table.rows) {
      const empresaCell = row[idxEmpresa];
      if (!empresaCell) continue;
      const name = empresaCell.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (!name) continue;
      const nameSlug = slugify(name);

      const alias = slugByFile.has(nameSlug) ? null : await db.companyAlias.findUnique({ where: { alias: nameSlug } });
      const companyId = slugByFile.get(nameSlug) ?? alias?.companyId;

      const priority = idxPrio >= 0 ? parseInt(row[idxPrio] ?? "", 10) || null : null;
      const pjBrRaw = idxPjBr >= 0 ? (row[idxPjBr] ?? "") : "";
      const pjBrazil: "SIM" | "PROVAVEL_SIM" | "A_CONFIRMAR" | "PROVAVEL_NAO" | "NAO" = /alta/i.test(pjBrRaw)
        ? "SIM"
        : /m[ée]dia/i.test(pjBrRaw)
          ? "PROVAVEL_SIM"
          : "A_CONFIRMAR";
      const careersCell = idxCareers >= 0 ? (row[idxCareers] ?? "") : "";

      let careersUrl: string | null = null;
      const urlMatch = /([a-z0-9.-]+\.[a-z]{2,}\/\S*)/i.exec(careersCell);
      if (urlMatch && !/ashby:|greenhouse:|lever:/.test(careersCell)) careersUrl = urlMatch[1]!;

      const data = {
        isFavorite: true,
        priority,
        pjBrazil,
        pjBrazilNote: pjBrRaw || null,
        sectorGroup: table.sectionHeading || null,
        stackSummary: idxStack >= 0 ? (row[idxStack] ?? null) : null,
        careersUrl,
      };

      const company = companyId
        ? await db.company.update({ where: { id: companyId }, data })
        : await db.company.upsert({
            where: { slug: nameSlug },
            create: { name, slug: nameSlug, ...data },
            update: data,
          });

      // "✅ provider:slug" cells double as a fallback board source — the
      // discover.py ATS dict (seeded separately, below) wins on conflict.
      const boardMatch = /(ashby|greenhouse|lever|breezy|workable):([a-z0-9._-]+)/i.exec(careersCell);
      if (boardMatch) {
        const provider = boardMatch[1]!.toUpperCase() as "ASHBY" | "GREENHOUSE" | "LEVER" | "BREEZY" | "WORKABLE";
        const slug = boardMatch[2]!;
        await db.companyBoard.upsert({
          where: { provider_slug: { provider, slug } },
          create: { companyId: company.id, provider, slug, note: "de _watchlist.md" },
          update: {},
        });
      }
    }
  }
}

async function seedAtsDictBoards(db: Db, report: ImportReport): Promise<void> {
  for (const entry of atsDict as { company: string; provider: string; slug: string }[]) {
    const provider = entry.provider as "ASHBY" | "GREENHOUSE" | "LEVER";
    const nameSlug = slugify(entry.company);
    const existingBySlug = await db.company.findUnique({ where: { slug: nameSlug } });
    const alias = existingBySlug ? null : await db.companyAlias.findUnique({ where: { alias: nameSlug } });
    const existingByAlias = alias ? await db.company.findUnique({ where: { id: alias.companyId } }) : null;
    const company =
      existingBySlug ?? existingByAlias ?? (await db.company.create({ data: { name: entry.company, slug: nameSlug, isFavorite: true } }));

    // discover.py's hand-verified dict wins on conflict — it excludes known
    // homonym traps (e.g. a same-named unrelated company on the same ATS
    // provider) that the raw watchlist column doesn't know to avoid.
    await db.companyBoard.upsert({
      where: { provider_slug: { provider, slug: entry.slug } },
      create: {
        companyId: company.id,
        provider,
        slug: entry.slug,
        note: "de discover.py ATS dict (autoridade)",
        verifiedAt: new Date(),
      },
      update: { companyId: company.id, note: "de discover.py ATS dict (autoridade)", verifiedAt: new Date() },
    });
    report.boardsSeeded++;
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
function mapSeniority(
  raw: unknown
): { value: "JUNIOR" | "MID" | "SENIOR" | "STAFF" | "SENIOR_STAFF" | "PRINCIPAL" | "UNKNOWN"; note: string | null } {
  const text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  const note = text || null;
  if (/senior[/ -]?staff|senior\/staff/.test(lower)) return { value: "SENIOR_STAFF", note };
  if (/principal/.test(lower)) return { value: "PRINCIPAL", note };
  if (/staff/.test(lower)) return { value: "STAFF", note };
  if (/senior/.test(lower)) return { value: "SENIOR", note };
  if (/pleno|mid/.test(lower)) return { value: "MID", note };
  if (/junior|júnior/.test(lower)) return { value: "JUNIOR", note };
  return { value: "UNKNOWN", note };
}

function mapWorkModel(raw: unknown): "REMOTO" | "HIBRIDO" | "PRESENCIAL" | "DESCONHECIDO" {
  const lower = String(raw ?? "").toLowerCase();
  if (lower.startsWith("remoto")) return "REMOTO";
  if (lower.startsWith("híbrido") || lower.startsWith("hibrido")) return "HIBRIDO";
  if (lower.startsWith("presencial")) return "PRESENCIAL";
  return "DESCONHECIDO";
}

function sourceKeyFromUrl(url: string | undefined): string {
  if (!url) return "vault-import";
  if (url.includes("ashbyhq.com")) return "ats:ashby";
  if (url.includes("greenhouse.io")) return "ats:greenhouse";
  if (url.includes("lever.co")) return "ats:lever";
  if (url.includes("smartrecruiters.com")) return "ats:smartrecruiters";
  if (url.includes("ycombinator.com")) return "hn";
  if (url.includes("remotive.com")) return "remotive";
  if (url.includes("remoteok")) return "remoteok";
  return "vault-import";
}

function parseLeadingTristate(raw: unknown): { value: "SIM" | "PROVAVEL_SIM" | "A_CONFIRMAR" | "PROVAVEL_NAO" | "NAO"; note: string | null } {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "A_CONFIRMAR", note: null };
  const lower = text.toLowerCase();
  if (/^provável\s+não|^provavel\s+nao/.test(lower)) return { value: "PROVAVEL_NAO", note: text };
  if (/^não|^nao/.test(lower)) return { value: "NAO", note: text };
  if (/^provável|^provavel/.test(lower)) return { value: "PROVAVEL_SIM", note: text };
  if (/^sim/.test(lower)) return { value: "SIM", note: text };
  return { value: "A_CONFIRMAR", note: text };
}

function extractBoldLabel(section: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`\\*\\*${label}:?\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[^*]+:\\*\\*|$)`, "i");
    const match = re.exec(section);
    if (match) return match[1]!.trim();
  }
  return null;
}

async function importJobs(db: Db, vaultDir: string, report: ImportReport): Promise<void> {
  const files = fs.readdirSync(vaultDir).filter((f) => f.endsWith(".md") && !f.startsWith("_") && !/ \d+\.md$/.test(f));

  for (const file of files) {
    const full = path.join(vaultDir, file);
    try {
      const { data, content } = resilientMatter(fs.readFileSync(full, "utf8"), report, file);
      if (data.tipo && data.tipo !== "vaga" && data.tipo !== "empresa-alvo") continue;

      const empresaName = String(data.empresa ?? "").trim();
      const cargo = String(data.cargo ?? "").trim();
      if (!empresaName || !cargo) {
        report.jobsSkipped.push({ file, reason: "faltando empresa ou cargo" });
        continue;
      }

      const nameSlug = slugify(empresaName);
      let company = await db.company.findUnique({ where: { slug: nameSlug } });
      if (!company) {
        const alias = await db.companyAlias.findUnique({ where: { alias: nameSlug } });
        company = alias ? await db.company.findUnique({ where: { id: alias.companyId } }) : null;
      }
      if (!company) {
        company = await db.company.create({ data: { name: empresaName, slug: nameSlug } });
      }

      const dedupTitle = cargo
        .replace(/\([^)]*\)/g, " ")
        .replace(/[:,–—-]/g, " ")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      const hb = parseLeadingTristate(data.contrata_brasil);
      const eq = parseLeadingTristate(data.equity);
      const currencyMatch = /\b(USD|EUR|BRL|GBP)\b/.exec(String(data.moeda ?? ""));

      const statusRaw = String(data.status ?? "1 - Triagem").toLowerCase();
      const status = STATUS_MAP[statusRaw] ?? "TRIAGEM";
      const seniority = mapSeniority(data.senioridade);

      // --- body: Fit section ---
      const fitSection = extractSection(content, /^##\s*Fit\b.*$/im);
      let fitWhy: string | null = null;
      let fitRedFlags: string | null = null;
      let fitToConfirm: string | null = null;
      let importNote: string | null = null;
      if (fitSection) {
        fitWhy = extractBoldLabel(fitSection, [
          "Por que casa \\(ou não\\)",
          "Por que casa",
          "Por que não casa",
          "Do anúncio real",
          "Por que é você",
          "Sinais de IC",
        ]);
        fitRedFlags = extractBoldLabel(fitSection, ["Red flags"]);
        fitToConfirm = extractBoldLabel(fitSection, ["A confirmar"]);
        if (fitWhy === null && fitRedFlags === null && fitToConfirm === null) {
          fitWhy = fitSection;
          importNote = "unstructured";
        }
      }

      // --- body: rejection reason (6 heading spellings) ---
      let rejectionReason: string | null = null;
      for (const heading of REJECTION_HEADINGS) {
        const re = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
        const section = extractSection(content, re);
        if (section) {
          rejectionReason = rejectionReason ? `${rejectionReason}\n\n${section}` : section;
        }
      }

      const stat = fs.statSync(full);
      const discoveredAt = data.data_encontrada ? new Date(data.data_encontrada as string) : stat.birthtime;

      const job = await db.job.upsert({
        where: { companyId_dedupTitle: { companyId: company.id, dedupTitle } },
        create: {
          companyId: company.id,
          title: cargo,
          dedupTitle,
          seniority: seniority.value,
          seniorityNote: seniority.note,
          workModel: mapWorkModel(data.modelo),
          locationRaw: data.modelo ? String(data.modelo) : null,
          hiresBrazil: hb.value,
          hiresBrazilNote: hb.note,
          equity: eq.value,
          equityNote: eq.note,
          currency: currencyMatch?.[1] ?? null,
          currencyNote: data.moeda ? String(data.moeda) : null,
          salaryMin: typeof data.salario_min === "number" ? data.salario_min : null,
          salaryMax: typeof data.salario_max === "number" ? data.salario_max : null,
          stack: Array.isArray(data.stack) ? data.stack.map(String) : [],
          sector: data.setor ? String(data.setor) : null,
          canonicalUrl: data.fonte ? String(data.fonte) : null,
          status,
          interest: typeof data.interesse === "number" ? data.interesse : 3,
          interestSource: "AGENT",
          rejectionReason,
          rejectedAt: rejectionReason && status === "DESCARTADA" ? stat.mtime : null,
          discoveredAt,
        },
        update: {
          status,
          interest: typeof data.interesse === "number" ? data.interesse : undefined,
          rejectionReason: rejectionReason ?? undefined,
        },
      });

      if (data.fonte) {
        const sourceKey = sourceKeyFromUrl(String(data.fonte));
        await db.jobSighting.upsert({
          where: { sourceKey_externalId: { sourceKey, externalId: `vault:${file}` } },
          create: { jobId: job.id, sourceKey, externalId: `vault:${file}`, url: String(data.fonte) },
          update: {},
        });
      }

      if (typeof data.interesse === "number") {
        const rubricHash = `vault-import:${file}`;
        const activeProfile = await db.searchProfile.findFirst({ where: { isActive: true } });
        if (activeProfile) {
          await db.jobScore.upsert({
            where: { jobId_rubricHash: { jobId: job.id, rubricHash } },
            create: {
              jobId: job.id,
              profileVersionId: activeProfile.id,
              model: "vault-import",
              promptVersion: "imported",
              rubricHash,
              interest: data.interesse,
              verdict: status === "DESCARTADA" ? "descartar" : "avancar",
              fitWhy,
              fitRedFlags,
              fitToConfirm,
              importNote,
            },
            update: {},
          });
        }
      }

      if (data.data_aplicacao) {
        const existingApp = await db.application.findFirst({ where: { jobId: job.id } });
        if (!existingApp) {
          await db.application.create({
            data: { jobId: job.id, appliedAt: new Date(data.data_aplicacao as string), notes: "Importado do vault." },
          });
        }
      }

      const existingChange = await db.jobStatusChange.findFirst({ where: { jobId: job.id, actor: "import" } });
      if (!existingChange) {
        await db.jobStatusChange.create({ data: { jobId: job.id, toStatus: status, actor: "import" } });
      }

      report.jobs++;
    } catch (err) {
      report.jobsSkipped.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
// JobSighting.sourceKey is a real foreign key into Source.key (so /lab can
// join sightings back to a source cleanly) — which means every sourceKey
// sourceKeyFromUrl() can possibly return must exist as a Source row BEFORE
// importJobs runs. Seeded from the SAME adapter registry the workers use
// (not a hand-rolled duplicate list) so `enabled` matches each adapter's
// real default — critical because this only ever runs `create`, never
// `update`: once a Source row exists, later boots' ensureSourcesSeeded()
// intentionally leaves `enabled` alone (a user's manual on/off toggle in
// /perfil must survive a restart), so seeding the wrong default here would
// stick forever. "vault-import" is the one synthetic, non-fetchable key,
// for postings whose original URL didn't map to a known adapter — always
// disabled, since there's nothing to "enable".
async function seedRequiredSources(db: Db): Promise<void> {
  const { ALL_ADAPTERS } = await import("../server/sources/registry");
  for (const adapter of ALL_ADAPTERS) {
    await db.source.upsert({
      where: { key: adapter.key },
      create: {
        key: adapter.key,
        kind: adapter.kind,
        label: adapter.key,
        enabled: adapter.defaultEnabled,
        rateLimitMs: adapter.defaultRateLimitMs,
      },
      update: {},
    });
  }
  await db.source.upsert({
    where: { key: "vault-import" },
    create: { key: "vault-import", kind: "AGGREGATOR", label: "vault-import", enabled: false },
    update: {},
  });
}

async function runImport(db: Db, localDir: string, report: ImportReport): Promise<void> {
  await seedRequiredSources(db);
  await importSearchProfile(db, localDir, report);
  await importResumes(db, localDir, report);
  await importContextDocuments(db, localDir, report);
  const slugByFile = await importCompanies(db, localDir, report);
  await importWatchlist(db, localDir, report, slugByFile);
  await seedAtsDictBoards(db, report);
  await importJobs(db, localDir, report);
}

class DryRunRollback extends Error {}

export async function importVault(opts: { vaultDir?: string; dryRun?: boolean } = {}): Promise<ImportReport> {
  const sourceDir = opts.vaultDir ?? env.VAULT_VAGAS_DIR;
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Vault não encontrado em ${sourceDir}. Confirme VAULT_VAGAS_DIR / --vault.`);
  }

  const report: ImportReport = {
    companies: 0,
    jobs: 0,
    jobsSkipped: [],
    boardsSeeded: 0,
    resumesImported: 0,
    contextDocsImported: 0,
    warnings: [],
  };

  const localDir = copyVaultLocally(sourceDir);
  console.log(`[import-vault] vault copiado para ${localDir}`);

  if (opts.dryRun) {
    // The whole import runs inside one interactive transaction and always
    // throws at the end — every write above went through `db` (the tx
    // handle), so nothing this pass touched survives the rollback. This is
    // the same function, `runImport`, that a real import calls; dry-run
    // isn't a separate parallel implementation that could quietly drift
    // from what actually ships.
    await prisma
      .$transaction(async (tx) => {
        await runImport(tx, localDir, report);
        throw new DryRunRollback();
      })
      .catch((err) => {
        if (!(err instanceof DryRunRollback)) throw err;
      });
  } else {
    await runImport(prisma, localDir, report);
  }

  fs.rmSync(localDir, { recursive: true, force: true });
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const vaultIdx = args.indexOf("--vault");
  const vaultDir = vaultIdx >= 0 ? args[vaultIdx + 1] : undefined;

  importVault({ vaultDir, dryRun })
    .then((report) => {
      console.log(`\n=== Relatório do import${dryRun ? " (dry-run, nada foi salvo)" : ""} ===`);
      console.log(`Empresas: ${report.companies}`);
      console.log(`Boards de ATS (discover.py + watchlist): ${report.boardsSeeded}`);
      console.log(`Currículos: ${report.resumesImported}`);
      console.log(`Documentos de contexto: ${report.contextDocsImported}`);
      console.log(`Vagas importadas: ${report.jobs}`);
      if (report.jobsSkipped.length) {
        console.log(`Vagas puladas: ${report.jobsSkipped.length}`);
        for (const s of report.jobsSkipped) console.log(`  - ${s.file}: ${s.reason}`);
      }
      if (report.warnings.length) {
        console.log(`Avisos:`);
        for (const w of report.warnings) console.log(`  - ${w}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[import-vault] falhou:", err);
      process.exit(1);
    });
}
