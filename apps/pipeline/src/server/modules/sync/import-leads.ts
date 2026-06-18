import { z } from "zod";
import { prisma } from "@pipeline/server/lib/prisma";
import { mapChannel } from "@/lib/funnel/map-channel";
import type { Channel, LeadStatus, Prisma } from "@/generated/prisma";

// One-off migration of the Google Sheets lead tracker (see
// ideas/milhasgrupo/README.md). Transition timestamps are unknown in the
// Sheet, so every first-reach column up the chain is backfilled from
// received_at and flagged as approximate in the audit event.

const SHEET_STATUS_MAP: Record<string, LeadStatus> = {
  "": "NEW",
  lead: "NEW",
  onboarding: "ONBOARDING",
  qualified: "QUALIFIED",
  active: "ACTIVE",
  issued: "CUSTOMER",
  cold: "COLD",
  lost: "LOST",
};

// Statuses passed through on the way to `status` (timestamps backfilled).
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

export const importLeadsPayloadSchema = z.object({
  slug: z.string(),
  leads: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        contact: z.string().optional(),
        status: z.string().default(""),
        received_at: z.string().optional(),
        utm_source: z.string().default(""),
        utm_medium: z.string().default(""),
        utm_campaign: z.string().default(""),
        referrer: z.string().default(""),
        alerts_sent: z.coerce.number().int().optional(),
        issuances: z.coerce.number().int().optional(),
        notes: z.string().optional(),
        form_data: z.record(z.string()).default({}),
      }),
    )
    .max(5000),
});

export type ImportLeadsPayload = z.infer<typeof importLeadsPayloadSchema>;

export async function importLeads(payload: ImportLeadsPayload) {
  const idea = await prisma.idea.findUnique({ where: { slug: payload.slug } });
  if (!idea) return { ok: false as const, error: `unknown idea "${payload.slug}"` };

  let created = 0;
  let skipped = 0;

  for (const row of payload.leads) {
    const existing = await prisma.lead.findUnique({
      where: { ideaId_email: { ideaId: idea.id, email: row.email } },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const statusKey = row.status.trim().toLowerCase();
    const status = SHEET_STATUS_MAP[statusKey];
    if (!status) {
      skipped++;
      console.warn(`[import:sheets] unknown status "${row.status}" for ${row.email}`);
      continue;
    }

    const receivedAt = row.received_at ? new Date(row.received_at) : new Date();
    const createdAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;

    const timestamps: Record<string, Date> = {};
    for (const reached of REACHED[status]) {
      const column = TIMESTAMP_COLUMN[reached];
      if (column) timestamps[column] = createdAt;
    }

    const attributes: Record<string, number> = {};
    if (row.alerts_sent != null) attributes.alerts_sent = row.alerts_sent;
    if (row.issuances != null) attributes.issuances = row.issuances;

    const lead = await prisma.lead.create({
      data: {
        ideaId: idea.id,
        email: row.email,
        contact: row.contact || null,
        formData: row.form_data as Prisma.InputJsonValue,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        utmCampaign: row.utm_campaign,
        referrer: row.referrer,
        channel: mapChannel({
          source: row.utm_source,
          medium: row.utm_medium,
          referrer: row.referrer,
        }) as Channel,
        status,
        notes: row.notes || null,
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
          actor: "import:sheets",
          note: "importado do Sheets; timestamps aproximados de received_at",
          occurredAt: createdAt,
        },
      });
    }
    created++;
  }

  return { ok: true as const, created, skipped };
}
