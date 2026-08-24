import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against a live call to
// https://himalayas.app/jobs/api?limit=2. `guid` is the stable identifier —
// there is no plain numeric/string `id`. No direct `url` field either;
// `applicationLink` is the closest equivalent.
type HimalayasJob = {
  guid: string;
  title: string;
  companyName: string;
  excerpt?: string;
  description?: string;
  applicationLink: string;
  minSalary?: number;
  maxSalary?: number;
  currency?: string;
  locationRestrictions?: string[];
  pubDate?: string;
};

type HimalayasResponse = { jobs: HimalayasJob[] };

export const himalayasAdapter: SourceAdapter = {
  key: "himalayas",
  kind: "AGGREGATOR",
  defaultEnabled: false, // opt-in — the original pipeline never enabled this one
  defaultRateLimitMs: 2000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const { status, data } = await fetchJson<HimalayasResponse>("https://himalayas.app/jobs/api?limit=100");
    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    const postings: RawJobPosting[] = data.jobs.map((j) => ({
      externalId: j.guid,
      url: j.applicationLink,
      title: j.title,
      companyName: j.companyName,
      locationRaw: (j.locationRestrictions ?? []).join(" · ") || "Remote",
      descriptionText: stripHtml(j.description ?? j.excerpt),
      salaryMinRaw: j.minSalary,
      salaryMaxRaw: j.maxSalary,
      salaryCurrencyRaw: j.currency,
      postedAt: j.pubDate ? new Date(j.pubDate) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
