import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against a live call to
// https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true
type GreenhouseJob = {
  id: number;
  title: string;
  location?: { name?: string } | null;
  absolute_url: string;
  content?: string; // HTML, entity-escaped
  updated_at?: string;
};

type GreenhouseBoard = { jobs: GreenhouseJob[] };

export const greenhouseAdapter: SourceAdapter = {
  key: "ats:greenhouse",
  kind: "ATS",
  defaultEnabled: true,
  defaultRateLimitMs: 1000,

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const slug = ctx.board?.slug;
    if (!slug) {
      return { postings: [], meta: { itemCount: 0, warnings: ["missing board slug"] } };
    }
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
    const { status, data } = await fetchJson<GreenhouseBoard>(url);

    if (status !== 200 || !data) {
      return { postings: [], meta: { httpStatus: status, itemCount: 0, warnings: [`http ${status}`] } };
    }

    const postings: RawJobPosting[] = data.jobs.map((j) => ({
      externalId: String(j.id),
      url: j.absolute_url,
      title: j.title,
      companyName: slug,
      locationRaw: j.location?.name ?? "",
      descriptionText: stripHtml(j.content),
      postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
      payload: j,
    }));

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
