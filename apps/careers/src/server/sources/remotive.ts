import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against a live call to
// https://remotive.com/api/remote-jobs?limit=2
type RemotiveJob = {
  id: number;
  title: string;
  company_name: string;
  candidate_required_location: string;
  description: string;
  salary?: string;
  url: string;
  publication_date?: string;
};

type RemotiveResponse = { jobs: RemotiveJob[] };

const ALLOWED_LOCATION_RE = /worldwide|americas|latam|brazil|brasil|usa/i;

export const remotiveAdapter: SourceAdapter = {
  key: "remotive",
  kind: "AGGREGATOR",
  defaultEnabled: true,
  defaultRateLimitMs: 2000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const { status, data } = await fetchJson<RemotiveResponse>(
      "https://remotive.com/api/remote-jobs?category=software-dev"
    );
    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    // Only Worldwide/Americas/LATAM/BR postings — same guard the original
    // pipeline used, since most Remotive listings are US/EU-only.
    const jobs = data.jobs.filter((j) => ALLOWED_LOCATION_RE.test(j.candidate_required_location));

    const postings: RawJobPosting[] = jobs.map((j) => ({
      externalId: String(j.id),
      url: j.url,
      title: j.title,
      companyName: j.company_name,
      locationRaw: j.candidate_required_location,
      descriptionText: stripHtml(j.description),
      compensationRaw: j.salary || undefined,
      postedAt: j.publication_date ? new Date(j.publication_date) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
