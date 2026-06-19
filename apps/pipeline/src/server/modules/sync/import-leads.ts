import { z } from "zod";
import { prisma } from "@pipeline/server/lib/prisma";
import { mapChannel } from "@/lib/funnel/map-channel";
import type { Channel, LeadStatus, Prisma } from "@/generated/prisma";

// Generic CSV/spreadsheet lead ingestion — bootstrap a funnel from existing
// lead data, then re-run anytime (idempotent upsert keyed on idea+email).
// The canonical payload below is what the /ops uploader and the CLI both send;
// header normalization (PT/EN aliases) happens at parse time.

// Status accepts the canonical names plus common PT/EN / sheet variants.
const STATUS_ALIASES: Record<string, LeadStatus> = {
  "": "NEW",
  "(vazio)": "NEW",
  new: "NEW",
  novo: "NEW",
  lead: "NEW",
  inscrito: "NEW",
  cadastro: "NEW",
  onboarding: "ONBOARDING",
  contatado: "ONBOARDING",
  info_incompleta: "ONBOARDING", // respondeu mas faltam dados — ainda coletando
  "info incompleta": "ONBOARDING",
  qualified: "QUALIFIED",
  qualificado: "QUALIFIED",
  active: "ACTIVE",
  ativo: "ACTIVE",
  engajado: "ACTIVE",
  monitorando: "ACTIVE", // monitoramento ativo = usando o produto
  monitoring: "ACTIVE",
  customer: "CUSTOMER",
  cliente: "CUSTOMER",
  issued: "CUSTOMER",
  emitido: "CUSTOMER",
  emitida: "CUSTOMER",
  pagante: "CUSTOMER",
  paid: "CUSTOMER",
  convertido: "CUSTOMER",
  cold: "COLD",
  frio: "COLD",
  lost: "LOST",
  perdido: "LOST",
  descartado: "LOST",
  "icp errado": "LOST", // fora do perfil ideal
  icp_errado: "LOST",
  "fora do icp": "LOST",
};

// Forward rank, so a re-import never regresses an advanced lead.
const STATUS_RANK: Record<LeadStatus, number> = {
  NEW: 0,
  ONBOARDING: 1,
  QUALIFIED: 2,
  ACTIVE: 3,
  CUSTOMER: 4,
  COLD: 1, // side state — re-engageable
  LOST: 0, // side state — terminal but low rank
};

// Which "ever-reached" timestamps to backfill for a given status.
const REACHED: Record<LeadStatus, LeadStatus[]> = {
  NEW: [],
  ONBOARDING: ["ONBOARDING"],
  QUALIFIED: ["ONBOARDING", "QUALIFIED"],
  ACTIVE: ["ONBOARDING", "QUALIFIED", "ACTIVE"],
  CUSTOMER: ["ONBOARDING", "QUALIFIED", "ACTIVE", "CUSTOMER"],
  COLD: ["ONBOARDING", "COLD"],
  LOST: ["LOST"],
};

const TIMESTAMP_COLUMN: Partial<Record<LeadStatus, string>> = {
  ONBOARDING: "onboardingAt",
  QUALIFIED: "qualifiedAt",
  ACTIVE: "activatedAt",
  CUSTOMER: "convertedAt",
  COLD: "coldAt",
  LOST: "lostAt",
};

// Accepts YYYY-MM-DD, ISO, and Brazilian DD/MM/YYYY (with optional time).
function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}${br[4] ?? ""}` : trimmed;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// BRL amount → integer cents. Accepts "99,90", "99.90", "1.234,56", numbers.
function parseMoneyCents(v?: string | number | null): number | null {
  if (v == null || v === "") return null;
  let n: number;
  if (typeof v === "number") n = v;
  else {
    const s = v.trim().replace(/[R$\s]/g, "");
    // if both separators present, the last one is the decimal
    const norm =
      s.includes(",") && s.includes(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(",", ".");
    n = parseFloat(norm);
  }
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const NUMERIC_ATTRS = new Set(["alerts_sent", "issuances"]);

const leadRowSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().optional(),
  contact: z.string().optional(),
  status: z.string().optional().default(""),
  created_at: z.string().optional(),
  activated_at: z.string().optional(),
  converted_at: z.string().optional(),
  utm_source: z.string().optional().default(""),
  utm_medium: z.string().optional().default(""),
  utm_campaign: z.string().optional().default(""),
  utm_content: z.string().optional().default(""),
  utm_term: z.string().optional().default(""),
  referrer: z.string().optional().default(""),
  customer_value: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional(),
  // any extra columns land here (group_size, travel_window, alerts_sent, ...)
  form_data: z.record(z.union([z.string(), z.number()])).default({}),
});

export const importLeadsPayloadSchema = z.object({
  slug: z.string(),
  // applied to rows that don't carry their own utm_source (channel attribution)
  defaultUtmSource: z.string().optional(),
  leads: z.array(leadRowSchema).max(5000),
});

export type ImportLeadsPayload = z.infer<typeof importLeadsPayloadSchema>;

export interface ImportResult {
  ok: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
}

export async function importLeads(payload: ImportLeadsPayload): Promise<ImportResult> {
  const idea = await prisma.idea.findUnique({ where: { slug: payload.slug } });
  if (!idea) return { ok: false, error: `ideia "${payload.slug}" não encontrada` };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of payload.leads) {
    const statusKey = (row.status ?? "").trim().toLowerCase();
    const status = STATUS_ALIASES[statusKey];
    if (!status) {
      skipped++;
      errors.push(`status desconhecido "${row.status}" (${row.email})`);
      continue;
    }

    const createdAt = parseDate(row.created_at) ?? new Date();

    // First-reach timestamps: backfill the reached chain from createdAt, then
    // override with explicit dates when the CSV provides them.
    const timestamps: Record<string, Date> = {};
    for (const reached of REACHED[status]) {
      const column = TIMESTAMP_COLUMN[reached];
      if (column) timestamps[column] = createdAt;
    }
    const explicitActivated = parseDate(row.activated_at);
    const explicitConverted = parseDate(row.converted_at);
    if (explicitActivated) timestamps.activatedAt = explicitActivated;
    if (explicitConverted) timestamps.convertedAt = explicitConverted;

    const utmSource = row.utm_source || payload.defaultUtmSource || "";
    const channel = mapChannel({
      source: utmSource,
      medium: row.utm_medium,
      referrer: row.referrer,
    }) as Channel;

    // Split numeric operational attrs out of the catch-all form_data.
    const attributes: Record<string, string | number> = {};
    const formData: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row.form_data)) {
      if (NUMERIC_ATTRS.has(key)) attributes[key] = Number(value) || 0;
      else formData[key] = value;
    }

    const existing = await prisma.lead.findUnique({
      where: { ideaId_email: { ideaId: idea.id, email: row.email } },
    });

    if (!existing) {
      const lead = await prisma.lead.create({
        data: {
          ideaId: idea.id,
          email: row.email,
          name: row.name || null,
          contact: row.contact || null,
          formData: formData as Prisma.InputJsonValue,
          utmSource,
          utmMedium: row.utm_medium,
          utmCampaign: row.utm_campaign,
          utmContent: row.utm_content,
          utmTerm: row.utm_term,
          referrer: row.referrer,
          channel,
          status,
          notes: row.notes || null,
          customerValueCents: parseMoneyCents(row.customer_value),
          attributes: attributes as Prisma.InputJsonValue,
          createdAt,
          ...timestamps,
        },
      });
      if (status !== "NEW") {
        await prisma.leadStatusEvent.create({
          data: {
            leadId: lead.id,
            fromStatus: null,
            toStatus: status,
            actor: "import:csv",
            note: "importado via CSV",
            occurredAt: timestamps[TIMESTAMP_COLUMN[status] ?? ""] ?? createdAt,
          },
        });
      }
      created++;
      continue;
    }

    // Re-import: CSV is authoritative for mutable fields. Never regress status
    // or clear a timestamp; advance + fill what's missing.
    const advance = STATUS_RANK[status] > STATUS_RANK[existing.status];
    const nextStatus = advance ? status : existing.status;
    const fillTimestamps: Record<string, Date> = {};
    for (const [col, val] of Object.entries(timestamps)) {
      if ((existing as Record<string, unknown>)[col] == null) fillTimestamps[col] = val;
    }

    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        name: row.name || existing.name,
        contact: row.contact || existing.contact,
        notes: row.notes ?? existing.notes,
        customerValueCents:
          parseMoneyCents(row.customer_value) ?? existing.customerValueCents,
        status: nextStatus,
        attributes: {
          ...((existing.attributes ?? {}) as Record<string, unknown>),
          ...attributes,
        } as Prisma.InputJsonValue,
        ...fillTimestamps,
      },
    });
    if (advance) {
      await prisma.leadStatusEvent.create({
        data: {
          leadId: existing.id,
          fromStatus: existing.status,
          toStatus: status,
          actor: "import:csv",
          note: "atualizado via re-import CSV",
        },
      });
    }
    updated++;
  }

  return { ok: true, created, updated, skipped, errors: errors.slice(0, 20) };
}
