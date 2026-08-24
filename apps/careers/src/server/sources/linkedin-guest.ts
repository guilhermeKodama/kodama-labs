import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";

// The user was told this violates LinkedIn's ToS and is fragile, and asked
// for it anyway — so it's contained by construction, not by discipline:
// disabled by default, a conservative rate limit, regex-only parsing (a
// markup change must yield zero postings, never a thrown exception), and
// every posting comes back `partial: true` so normalize.ts routes it to
// NEEDS_REVIEW instead of ever auto-promoting to a Job. Field patterns
// verified against a live fetch of the seeMoreJobPostings endpoint on
// 2026-08-20 — LinkedIn can and will change this markup without notice.
const KEYWORDS = ["staff engineer", "principal engineer", "senior software engineer"];
const LOCATION = "Remote";

function extractCards(html: string): RawJobPosting[] {
  const postings: RawJobPosting[] = [];
  // Split on each job card's opening li — tolerant of the exact class list
  // changing, since it only anchors on the one stable identifier LinkedIn's
  // own front end depends on: the entity urn.
  const cardRe = /data-entity-urn="urn:li:jobPosting:(\d+)"/g;
  let match: RegExpExecArray | null;
  const starts: { id: string; index: number }[] = [];
  while ((match = cardRe.exec(html))) {
    starts.push({ id: match[1]!, index: match.index });
  }

  for (let i = 0; i < starts.length; i++) {
    const { id, index } = starts[i]!;
    const end = starts[i + 1]?.index ?? html.length;
    const chunk = html.slice(index, Math.min(end, index + 4000));

    const title = /<span class="sr-only">\s*([\s\S]*?)\s*<\/span>/.exec(chunk)?.[1]?.trim();
    const company = /class="hidden-nested-link"[^>]*>\s*([\s\S]*?)\s*<\/a>/.exec(chunk)?.[1]?.trim();
    const location = /class="job-search-card__location">\s*([\s\S]*?)\s*<\/span>/.exec(chunk)?.[1]?.trim();
    const href = /href="([^"?]+)/.exec(chunk)?.[1];
    const datetime = /<time[^>]*datetime="([^"]+)"/.exec(chunk)?.[1];

    if (!title || !href) continue; // markup changed under us — skip this card, not the run

    postings.push({
      externalId: id,
      url: href,
      title,
      companyName: company ?? "",
      locationRaw: location ?? "",
      // The guest endpoint returns cards only, never a job description —
      // this is a structural limit, not a parsing gap.
      descriptionText: "",
      postedAt: datetime ? new Date(datetime) : undefined,
      payload: { title, company, location, href },
      partial: true,
    });
  }
  return postings;
}

export const linkedinGuestAdapter: SourceAdapter = {
  key: "linkedin_guest",
  kind: "SCRAPE",
  defaultEnabled: false,
  defaultRateLimitMs: 5000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const warnings: string[] = [];
    const all: RawJobPosting[] = [];

    for (const keyword of KEYWORDS) {
      const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(
        keyword
      )}&location=${encodeURIComponent(LOCATION)}&start=0`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(20_000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
          },
        });

        if (res.status === 429 || res.status === 999) {
          // LinkedIn's block signal — a multi-hour cooldown, not the
          // standard 30s×2ⁿ backoff other sources use.
          return {
            postings: all,
            meta: { httpStatus: res.status, itemCount: all.length, warnings: [...warnings, "rate-limited by linkedin"] },
          };
        }
        if (!res.ok) {
          warnings.push(`${keyword}: http ${res.status}`);
          continue;
        }

        const html = await res.text();
        all.push(...extractCards(html));
      } catch (err) {
        warnings.push(`${keyword}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { postings: all, meta: { itemCount: all.length, warnings } };
  },
};
