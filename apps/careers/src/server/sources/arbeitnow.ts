import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against a live call to
// https://www.arbeitnow.com/api/job-board-api. No numeric id — `slug` is the
// stable per-posting identifier.
type ArbeitnowJob = {
  slug: string;
  title: string;
  company_name: string;
  location: string;
  remote: boolean;
  description: string;
  url: string;
  created_at?: number; // epoch seconds
};

type ArbeitnowResponse = { data: ArbeitnowJob[] };

export const arbeitnowAdapter: SourceAdapter = {
  key: "arbeitnow",
  kind: "AGGREGATOR",
  defaultEnabled: true,
  defaultRateLimitMs: 2000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const { status, data } = await fetchJson<ArbeitnowResponse>(
      "https://www.arbeitnow.com/api/job-board-api"
    );
    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    const jobs = data.data.filter((j) => j.remote);
    const postings: RawJobPosting[] = jobs.map((j) => ({
      externalId: j.slug,
      url: j.url,
      title: j.title,
      companyName: j.company_name,
      locationRaw: j.location || "Remote",
      descriptionText: stripHtml(j.description),
      postedAt: j.created_at ? new Date(j.created_at * 1000) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
