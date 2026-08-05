// Single UTM/source → Channel mapping, shared by the lead webhook and the GA4
// ingestion job so sessions and leads always land in the same bucket.

export type ChannelValue = "META" | "GOOGLE" | "ORGANIC" | "DIRECT" | "OTHER";

const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig", "an"]);
const GOOGLE_PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paid_search"]);
const ORGANIC_MEDIUMS = new Set(["organic", "referral", "social"]);

// GA4 placeholder values mean "absent"
const GA4_PLACEHOLDERS = new Set(["(direct)", "(none)", "(not set)"]);

function normalize(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  return GA4_PLACEHOLDERS.has(v) ? "" : v;
}

export function mapChannel(input: {
  source?: string | null;
  medium?: string | null;
  gclid?: string | null;
  referrer?: string | null;
}): ChannelValue {
  const source = normalize(input.source);
  const medium = normalize(input.medium);
  const gclid = (input.gclid ?? "").trim();
  const referrer = (input.referrer ?? "").trim();

  // gclid wins: Google Ads auto-tagging often arrives without any utm_* params
  // (the playbook relies on conversion tracking, not UTMs).
  if (gclid) return "GOOGLE";

  if (META_SOURCES.has(source) || /facebook|instagram/.test(source)) {
    return "META";
  }

  // medium guard keeps organic Google out of the paid GOOGLE bucket
  if (source.includes("google")) {
    return GOOGLE_PAID_MEDIUMS.has(medium) ? "GOOGLE" : "ORGANIC";
  }

  if (ORGANIC_MEDIUMS.has(medium)) return "ORGANIC";
  if (!source && !medium) {
    return referrer ? "ORGANIC" : "DIRECT";
  }

  return "OTHER";
}
