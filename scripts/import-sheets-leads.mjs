#!/usr/bin/env node
// One-off import of the Google Sheets lead tracker into the pipeline dashboard.
//
//   node scripts/import-sheets-leads.mjs --idea milhasgrupo path/to/export.csv
//   PIPELINE_URL=https://... SYNC_SECRET=... node scripts/import-sheets-leads.mjs --idea milhasgrupo leads.csv
//
// Expected columns (the MilhasGrupo sheet layout — extra columns become form_data):
//   received_at | email | contact | group_size | travel_window | utm_source |
//   utm_medium | utm_campaign | referrer | status | alerts_sent | issuances | notes
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const ideaIndex = args.indexOf("--idea");
const slug = ideaIndex >= 0 ? args[ideaIndex + 1] : null;
// --source <utm_source>: attribute rows without their own utm_source to a
// channel (e.g. "meta"). Mirrors the "Attribute to channel" picker in the UI.
const sourceIndex = args.indexOf("--source");
const defaultUtmSource = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
const flagValues = new Set([
  ideaIndex >= 0 ? ideaIndex + 1 : -1,
  sourceIndex >= 0 ? sourceIndex + 1 : -1,
]);
const csvPath = args.filter((a, i) => !a.startsWith("--") && !flagValues.has(i))[0];

if (!slug || !csvPath) {
  console.error(
    "usage: node scripts/import-sheets-leads.mjs --idea <slug> [--source meta] <export.csv>",
  );
  process.exit(1);
}

// Minimal CSV parser with quoted-field support (notes contain commas).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

// Canonical columns the importer understands; anything else → form_data.
// Header aliases (PT/EN) map onto these before splitting.
const HEADER_ALIASES = {
  "e-mail": "email",
  nome: "name",
  nome_usado: "name",
  contato: "contact",
  telefone: "contact",
  whatsapp: "contact",
  telegram: "contact",
  data: "created_at",
  criado_em: "created_at",
  recebido_em: "created_at",
  received_at: "created_at",
  ativado_em: "activated_at",
  convertido_em: "converted_at",
  emitido_em: "converted_at",
  observacoes: "notes",
  notas: "notes",
  obs: "notes",
  fonte: "utm_source",
  campanha: "utm_campaign",
  valor: "customer_value",
  receita: "customer_value",
  ltv: "customer_value",
};

const CANONICAL = new Set([
  "email",
  "name",
  "contact",
  "status",
  "created_at",
  "activated_at",
  "converted_at",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
  "customer_value",
  "notes",
]);

const text = await readFile(csvPath, "utf8");
const rows = parseCsv(text);
if (rows.length < 2) {
  console.error("CSV has no data rows");
  process.exit(1);
}

const normalizeHeader = (h) => {
  const key = h.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? key;
};
const header = rows[0].map(normalizeHeader);
const leads = [];
const errors = [];

for (let i = 1; i < rows.length; i++) {
  const record = Object.fromEntries(header.map((h, j) => [h, (rows[i][j] ?? "").trim()]));
  if (!record.email) {
    errors.push(`row ${i + 1}: missing email — skipped`);
    continue;
  }
  const lead = { form_data: {} };
  for (const [key, value] of Object.entries(record)) {
    if (value === "") continue;
    if (CANONICAL.has(key)) lead[key] = value;
    else lead.form_data[key] = value;
  }
  leads.push(lead);
}

for (const e of errors) console.warn(`⚠ ${e}`);
console.log(`parsed ${leads.length} lead(s) from ${csvPath}`);

async function readEnvLocal(key) {
  for (const file of ["apps/pipeline/.env.local", "apps/pipeline/.env"]) {
    try {
      const content = await readFile(join(REPO_ROOT, file), "utf8");
      const line = content.split("\n").find((l) => l.trim().startsWith(`${key}=`));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch {
      // keep looking
    }
  }
  return undefined;
}

const baseUrl = process.env.PIPELINE_URL ?? "http://localhost:3004";
const secret = process.env.SYNC_SECRET ?? (await readEnvLocal("SYNC_SECRET"));
if (!secret) {
  console.error("SYNC_SECRET not set (env or apps/pipeline/.env.local)");
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/sync/import-leads`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify({ slug, defaultUtmSource, leads }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) {
  console.error(`import failed: ${res.status}`, JSON.stringify(body));
  process.exit(1);
}
console.log(`✓ imported ${body.created} lead(s), ${body.skipped} skipped (already exist / unknown status)`);
