import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against a live call to https://remoteok.com/api.
// The response's first array element is a legal notice, not a job — it has
// no `id`/`position` fields. Filter it out rather than slicing [1:], since
// its exact position isn't a documented guarantee.
type RemoteOkItem = {
  id?: string;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  date?: string;
  tags?: string[];
  legal?: string; // present only on the notice row
};

export const remoteOkAdapter: SourceAdapter = {
  key: "remoteok",
  kind: "AGGREGATOR",
  defaultEnabled: true,
  defaultRateLimitMs: 2000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const { status, data } = await fetchJson<RemoteOkItem[]>("https://remoteok.com/api");
    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    const jobs = data.filter((j) => !j.legal && j.id && j.position);
    const postings: RawJobPosting[] = jobs.map((j) => ({
      externalId: j.id!,
      url: j.url ?? `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`,
      title: j.position!,
      companyName: j.company ?? "",
      locationRaw: j.location ?? "",
      descriptionText: stripHtml(j.description),
      salaryMinRaw: j.salary_min,
      salaryMaxRaw: j.salary_max,
      postedAt: j.date ? new Date(j.date) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
