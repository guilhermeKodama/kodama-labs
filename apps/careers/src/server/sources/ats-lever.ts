import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson } from "./types";

// Field names verified against live calls to
// https://api.lever.co/v0/postings/tinybird?mode=json and .../metabase.
// Note the response is a bare top-level ARRAY, not {jobs: [...]}. A dict
// response (Lever's shape for a nonexistent board) means error, not data —
// guard on Array.isArray, not just a truthy check.
type LeverJob = {
  id: string;
  text: string; // title
  hostedUrl: string;
  descriptionPlain?: string;
  salaryDescriptionPlain?: string;
  createdAt?: number; // epoch ms
  categories?: {
    location?: string;
    allLocations?: string[];
    commitment?: string;
  };
};

export const leverAdapter: SourceAdapter = {
  key: "ats:lever",
  kind: "ATS",
  defaultEnabled: true,
  defaultRateLimitMs: 1000,

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const slug = ctx.board?.slug;
    if (!slug) {
      return { postings: [], meta: { itemCount: 0, warnings: ["missing board slug"] } };
    }
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
    const { status, data } = await fetchJson<LeverJob[] | Record<string, unknown>>(url);

    if (status !== 200 || !data || !Array.isArray(data)) {
      return {
        postings: [],
        meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status} or non-array response`] },
      };
    }

    const locations = (j: LeverJob) =>
      [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(" · ");

    const postings: RawJobPosting[] = data.map((j) => ({
      externalId: j.id,
      url: j.hostedUrl,
      title: j.text,
      companyName: slug,
      locationRaw: locations(j) || (j.categories?.commitment ?? ""),
      descriptionText: j.descriptionPlain ?? "",
      compensationRaw: j.salaryDescriptionPlain ?? undefined,
      postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
