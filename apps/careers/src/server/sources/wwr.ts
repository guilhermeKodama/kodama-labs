import { XMLParser } from "fast-xml-parser";
import type { SourceAdapter, FetchContext, FetchResult, RawJobPosting } from "./types";

// WeWorkRemotely publishes RSS, not JSON — verified against a live fetch of
// https://weworkremotely.com/categories/remote-programming-jobs.rss. Title
// is "Company: Role", split on the FIRST colon only (roles routinely
// contain colons of their own, e.g. "Senior Engineer: Platform").
type WwrItem = {
  title: string;
  link: string;
  guid: string;
  description?: string;
  region?: string;
  category?: string;
  pubDate?: string;
};

const parser = new XMLParser({ ignoreAttributes: true });

export const wwrAdapter: SourceAdapter = {
  key: "weworkremotely",
  kind: "AGGREGATOR",
  defaultEnabled: true,
  defaultRateLimitMs: 2000,

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    const res = await fetch("https://weworkremotely.com/categories/remote-programming-jobs.rss", {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; careers-app/1.0)" },
    });
    if (!res.ok) {
      return { postings: [], meta: { httpStatus: res.status, itemCount: 0, warnings: [`http ${res.status}`] } };
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as {
      rss?: { channel?: { item?: WwrItem | WwrItem[] } };
    };
    const rawItems = parsed.rss?.channel?.item;
    const items: WwrItem[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    const postings: RawJobPosting[] = items.map((item) => {
      const sep = item.title.indexOf(":");
      const companyName = sep > 0 ? item.title.slice(0, sep).trim() : "";
      const title = sep > 0 ? item.title.slice(sep + 1).trim() : item.title;
      return {
        externalId: item.guid,
        url: item.link,
        title,
        companyName,
        locationRaw: item.region ?? "Remote",
        descriptionText: String(item.description ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s{2,}/g, " ")
          .trim(),
        postedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        payload: item,
      };
    });

    return { postings, meta: { httpStatus: 200, itemCount: postings.length, warnings: [] } };
  },
};
