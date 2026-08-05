import { z } from "zod";
import { prisma } from "@pipeline/server/lib/prisma";
import { mapChannel } from "@/lib/funnel/map-channel";
import type { Channel, Prisma } from "@/generated/prisma";

// Tolerant by design: the intake form serializes multi-value fields as string
// arrays, idea-specific fields vary, and we must never burn a paid lead on a
// schema mismatch. Strict shape lives only on the few fields we map to columns.
const str = z.union([z.string(), z.array(z.string())]).transform((v) =>
  Array.isArray(v) ? (v[0] ?? "") : v,
);

const leadPayloadSchema = z
  .object({
    email: str.pipe(z.string().trim().toLowerCase().email()),
    contact: str.optional(),
    name: str.optional(),
    utm_source: str.optional(),
    utm_medium: str.optional(),
    utm_campaign: str.optional(),
    utm_content: str.optional(),
    utm_term: str.optional(),
    referrer: str.optional(),
    gclid: str.optional(),
    wbraid: str.optional(),
    receivedAt: str.optional(),
  })
  .catchall(z.union([z.string(), z.array(z.string())]));

const MAPPED_KEYS = new Set([
  "email",
  "contact",
  "name",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
  "gclid",
  "wbraid",
  "receivedAt",
]);

export interface IntakeResult {
  ok: boolean;
  leadId?: string;
  error?: string;
}

export async function intakeLead(
  ideaId: string,
  body: unknown,
): Promise<IntakeResult> {
  const parsed = leadPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `invalid_payload: ${issue?.path.join(".")} ${issue?.message}`,
    };
  }

  const p = parsed.data;
  const formData: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(p)) {
    if (!MAPPED_KEYS.has(key)) {
      formData[key] = value as string | string[];
    }
  }

  const gclid = p.gclid || p.wbraid || "";
  const channel = mapChannel({
    source: p.utm_source,
    medium: p.utm_medium,
    gclid,
    referrer: p.referrer,
  }) as Channel;

  const receivedAt = p.receivedAt ? new Date(p.receivedAt) : new Date();
  const createdAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;

  const lead = await prisma.lead.upsert({
    where: { ideaId_email: { ideaId, email: p.email } },
    create: {
      ideaId,
      email: p.email,
      contact: p.contact || null,
      name: p.name || null,
      formData: formData as Prisma.InputJsonValue,
      utmSource: p.utm_source ?? "",
      utmMedium: p.utm_medium ?? "",
      utmCampaign: p.utm_campaign ?? "",
      utmContent: p.utm_content ?? "",
      utmTerm: p.utm_term ?? "",
      referrer: p.referrer ?? "",
      gclid,
      channel,
      createdAt,
    },
    // Resubmits bump the counter and fill a missing contact; first-touch
    // attribution and form answers are kept from the original submission.
    update: {
      resubmitCount: { increment: 1 },
      ...(p.contact ? { contact: p.contact } : {}),
    },
  });

  return { ok: true, leadId: lead.id };
}
