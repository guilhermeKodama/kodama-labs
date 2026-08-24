import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson } from "./types";

// The user removed HN as a source from the original vault pipeline on
// 2026-08-05 ("fórum ≠ job board; só vagas de boards reais daqui em
// diante") — 27 postings were batch-discarded when that happened. It's
// wired back in here but defaultEnabled=false, matching that decision:
// available if the user turns it on, off until they do.
//
// Two-step fetch verified live: search_by_date for the newest thread whose
// title starts with "Ask HN: Who is hiring?", then items/{id} for its
// top-level comments (each comment is one posting, in loose pipe/line-
// delimited prose — low precision by nature of the source).
type HnSearchHit = { objectID: string; title: string; created_at: string };
type HnSearchResponse = { hits: HnSearchHit[] };
type HnComment = {
  id: number;
  author: string | null;
  text: string | null;
  created_at: string;
  children?: HnComment[];
};
type HnItem = { id: number; title: string; children: HnComment[] };

function stripHnHtml(html: string): string {
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();
}

export const hnAdapter: SourceAdapter = {
  key: "hn",
  kind: "FORUM",
  defaultEnabled: false,
  defaultRateLimitMs: 3000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const search = await fetchJson<HnSearchResponse>(
      'https://hn.algolia.com/api/v1/search_by_date?query=%22Who%20is%20hiring%22&tags=story&restrictSearchableAttributes=title&hitsPerPage=10'
    );
    if (search.status !== 200 || !search.data) {
      return { postings: [], meta: { httpStatus: search.status, itemCount: 0, warnings: [`http ${search.status}`] } };
    }

    const thread = search.data.hits.find((h) => h.title.startsWith("Ask HN: Who is hiring?"));
    if (!thread) {
      return { postings: [], meta: { itemCount: 0, warnings: ["no current who-is-hiring thread found"] } };
    }

    const item = await fetchJson<HnItem>(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
    if (item.status !== 200 || !item.data) {
      return { postings: [], meta: { httpStatus: item.status, itemCount: 0, warnings: [`http ${item.status}`] } };
    }

    const postings: RawJobPosting[] = (item.data.children ?? [])
      .filter((c) => c.text && !c.text.startsWith("[flagged]") && !c.text.startsWith("[dead]"))
      .map((c) => {
        const text = stripHnHtml(c.text!);
        const firstLine = text.split("\n")[0] ?? text.slice(0, 120);
        return {
          externalId: String(c.id),
          url: `https://news.ycombinator.com/item?id=${c.id}`,
          title: firstLine.slice(0, 200),
          companyName: firstLine.split(/[\|–—-]/)[0]?.trim().slice(0, 80) ?? "",
          locationRaw: "",
          descriptionText: text,
          postedAt: new Date(c.created_at),
          payload: c,
          partial: true, // no structured fields — needs human review before promotion
        };
      });

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
