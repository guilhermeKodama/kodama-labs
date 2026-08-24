/** slugify: lowercase, strip accents, non-alnum -> hyphen, collapse, trim. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Collapses "Senior Platform Engineer: Storage (Remote, US)" and
// "senior-platform-engineer-storage" to the same key so the same role
// re-posted with slightly different formatting still dedups.
export function normalizeTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/[:,–—-]/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const WORLDWIDE_RE = /worldwide|global|anywhere|remote[- ]first/i;
const AMERICAS_RE = /americas?|latam|latin america|brazil|brasil|us(a)?\b|usa|canada|mexico/i;
const EUROPE_RE = /europe|emea|uk\b|united kingdom|germany|france|spain|portugal/i;
const APAC_RE = /apac|asia|india|japan|singapore|australia/i;

/** Best-effort region tags from free-text location strings. Never throws. */
export function normalizeRegions(locationRaw: string): string[] {
  const regions = new Set<string>();
  if (WORLDWIDE_RE.test(locationRaw)) regions.add("worldwide");
  if (AMERICAS_RE.test(locationRaw)) regions.add("americas");
  if (/brazil|brasil/i.test(locationRaw)) regions.add("brazil");
  if (/latam|latin america/i.test(locationRaw)) regions.add("latam");
  if (EUROPE_RE.test(locationRaw)) regions.add("europe");
  if (APAC_RE.test(locationRaw)) regions.add("apac");
  return [...regions];
}

/** A posting is region-viable for a Brazil-based remote search. */
export function regionOk(locationRaw: string): boolean {
  if (!locationRaw) return true; // absent location isn't grounds to discard — same rule as salary
  const regions = normalizeRegions(locationRaw);
  if (regions.length === 0) return true; // unrecognized string — don't guess-discard
  return (
    regions.includes("worldwide") ||
    regions.includes("americas") ||
    regions.includes("brazil") ||
    regions.includes("latam")
  );
}

const TRISTATE_LEADING_RE: [RegExp, "SIM" | "PROVAVEL_SIM" | "PROVAVEL_NAO" | "NAO"][] = [
  [/^prov[aá]vel\s+n[aã]o/i, "PROVAVEL_NAO"],
  [/^n[aã]o\b/i, "NAO"],
  [/^prov[aá]vel/i, "PROVAVEL_SIM"],
  [/^sim\b/i, "SIM"],
];

/**
 * Splits the vault's "<enum> (<justification>)" pattern into a Tristate
 * enum plus the full original text as a note. Matches on the LEADING token
 * only — the rest of the string is prose written for a human, not
 * something to parse further.
 */
export function parseTristate(
  raw: string | null | undefined
): { value: "SIM" | "PROVAVEL_SIM" | "A_CONFIRMAR" | "PROVAVEL_NAO" | "NAO"; note: string | null } {
  if (!raw || !raw.trim()) return { value: "A_CONFIRMAR", note: null };
  const trimmed = raw.trim();
  for (const [re, value] of TRISTATE_LEADING_RE) {
    if (re.test(trimmed)) return { value, note: trimmed };
  }
  return { value: "A_CONFIRMAR", note: trimmed };
}

/** First ISO-ish currency code found in free text, e.g. "USD (provável — remoto global)". */
export function parseCurrency(raw: string | null | undefined): { code: string | null; note: string | null } {
  if (!raw) return { code: null, note: null };
  const match = /\b(USD|EUR|BRL|GBP|CAD|AUD)\b/.exec(raw);
  return { code: match?.[1] ?? null, note: raw.trim() || null };
}
