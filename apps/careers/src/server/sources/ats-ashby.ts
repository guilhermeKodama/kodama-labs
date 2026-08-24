import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson } from "./types";

// Field names verified against a live call to
// https://api.ashbyhq.com/posting-api/job-board/supabase — do not guess at
// this shape from memory, it has changed shape across Ashby API versions.
type AshbyJob = {
  id: string;
  title: string;
  location: string;
  secondaryLocations?: { location: string }[];
  jobUrl: string;
  descriptionPlain: string;
  publishedAt?: string;
  compensation?: { compensationTierSummary?: string | null } | null;
};

type AshbyBoard = { jobs: AshbyJob[] };

export const ashbyAdapter: SourceAdapter = {
  key: "ats:ashby",
  kind: "ATS",
  defaultEnabled: true,
  defaultRateLimitMs: 1000,

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const slug = ctx.board?.slug;
    if (!slug) {
      return { postings: [], meta: { itemCount: 0, warnings: ["missing board slug"] } };
    }
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
    const { status, data } = await fetchJson<AshbyBoard>(url);

    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    // secondaryLocations often carries "Brazil" even when the primary
    // location string doesn't — a board fetch that only reads `location`
    // silently misses BR-eligible postings (this bit the original discover.py
    // pipeline more than once; DuckDuckGo and Nango both list Brazil only
    // in secondaryLocations).
    const postings: RawJobPosting[] = data.jobs.map((j) => {
      const locations = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)]
        .filter(Boolean)
        .join(" · ");
      return {
        externalId: j.id,
        url: j.jobUrl,
        title: j.title,
        // The Company is already known (board.companyId) — normalize.ts
        // resolves it directly from the board, not by name-matching this
        // field. It only needs to be a readable label for RawPosting.
        companyName: slug,
        locationRaw: locations,
        descriptionText: j.descriptionPlain ?? "",
        compensationRaw: j.compensation?.compensationTierSummary ?? undefined,
        postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
        payload: j,
      };
    });

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
