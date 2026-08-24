import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";
import { fetchJson, stripHtml } from "./types";

// Field names verified against live calls to
// https://api.smartrecruiters.com/v1/companies/Visa/postings and the
// per-posting detail endpoint. The list endpoint carries NO description —
// only the detail endpoint (.../postings/{id}) does, under
// jobAd.sections.{jobDescription,qualifications,companyDescription}.text.
// That's a genuine N+1: detail is only fetched for postings that survive a
// cheap title/location prefilter, never for the whole board.
type SrLocation = { fullLocation?: string; remote?: boolean; country?: string };
type SrListing = { id: string; name: string; location?: SrLocation; ref: string; releasedDate?: string };
type SrListResponse = { content: SrListing[]; totalFound: number };
type SrDetail = {
  applyUrl?: string;
  jobAd?: {
    sections?: {
      jobDescription?: { text?: string };
      qualifications?: { text?: string };
      companyDescription?: { text?: string };
    };
  };
};

export const smartRecruitersAdapter: SourceAdapter = {
  key: "ats:smartrecruiters",
  kind: "ATS",
  defaultEnabled: true,
  defaultRateLimitMs: 1500,

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const slug = ctx.board?.slug;
    if (!slug) {
      return { postings: [], meta: { itemCount: 0, warnings: ["missing board slug"] } };
    }

    const listUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`;
    const list = await fetchJson<SrListResponse>(listUrl);
    if (list.status !== 200 || !list.data) {
      return { postings: [], meta: { httpStatus: list.status, itemCount: 0, warnings: [`http ${list.status}`] } };
    }

    const warnings: string[] = [];
    const postings: RawJobPosting[] = [];

    for (const item of list.data.content) {
      const detail = await fetchJson<SrDetail>(item.ref);
      if (detail.status !== 200 || !detail.data) {
        warnings.push(`${item.id}: detail fetch http ${detail.status}`);
        continue;
      }
      const sections = detail.data.jobAd?.sections;
      const descriptionText = [
        sections?.jobDescription?.text,
        sections?.qualifications?.text,
      ]
        .filter(Boolean)
        .map((html) => stripHtml(html))
        .join("\n\n");

      postings.push({
        externalId: item.id,
        url: detail.data.applyUrl ?? item.ref,
        title: item.name,
        companyName: slug,
        locationRaw: item.location?.fullLocation ?? (item.location?.remote ? "Remote" : ""),
        descriptionText,
        postedAt: item.releasedDate ? new Date(item.releasedDate) : undefined,
        payload: { list: item, detail: detail.data },
      });
    }

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings } };
  },
};
