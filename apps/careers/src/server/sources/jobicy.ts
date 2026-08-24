import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against a live call to
// https://jobicy.com/api/v2/remote-jobs?count=2 — note the camelCase keys
// (jobTitle, not title) differ from every other aggregator here.
type JobicyJob = {
  id: number;
  jobTitle: string;
  companyName: string;
  jobGeo?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  url: string;
  pubDate?: string;
};

type JobicyResponse = { jobs: JobicyJob[] };

export const jobicyAdapter: SourceAdapter = {
  key: "jobicy",
  kind: "AGGREGATOR",
  defaultEnabled: true,
  defaultRateLimitMs: 2000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const { status, data } = await fetchJson<JobicyResponse>(
      "https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev"
    );
    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    const postings: RawJobPosting[] = data.jobs.map((j) => ({
      externalId: String(j.id),
      url: j.url,
      title: j.jobTitle,
      companyName: j.companyName,
      locationRaw: j.jobGeo ?? "Remote",
      descriptionText: stripHtml(j.jobDescription ?? j.jobExcerpt),
      salaryMinRaw: j.salaryMin,
      salaryMaxRaw: j.salaryMax,
      salaryCurrencyRaw: j.salaryCurrency,
      postedAt: j.pubDate ? new Date(j.pubDate) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
