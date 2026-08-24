import type { Source, CompanyBoard, SourceKind } from "../../generated/prisma";

export type RawJobPosting = {
  externalId: string; // stable per source — the RawPosting dedup anchor
  url: string;
  title: string;
  companyName: string;
  locationRaw: string;
  descriptionText: string; // HTML already stripped + entity-decoded
  compensationRaw?: string;
  // Some aggregators (RemoteOK, Himalayas, Jobicy) supply structured numeric
  // salary bounds directly rather than only a free-text blurb — kept
  // alongside compensationRaw so normalize.ts doesn't have to re-parse them
  // out of prose it already had as numbers.
  salaryMinRaw?: number;
  salaryMaxRaw?: number;
  salaryCurrencyRaw?: string;
  postedAt?: Date;
  payload: unknown; // untouched source object, stored verbatim
  /** true when the adapter physically cannot supply a body (e.g. LinkedIn cards) */
  partial?: boolean;
};

export type FetchContext = {
  source: Source;
  board?: CompanyBoard; // ATS adapters only
  log: (msg: string) => void;
};

export type FetchResult = {
  postings: RawJobPosting[];
  meta: { httpStatus?: number; itemCount: number; warnings: string[] };
};

export interface SourceAdapter {
  readonly key: string;
  readonly kind: SourceKind;
  readonly defaultEnabled: boolean;
  readonly defaultRateLimitMs: number;
  fetch(ctx: FetchContext): Promise<FetchResult>;
}

/** Strips tags and decodes the handful of entities ATS descriptions actually use. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 20_000
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; careers-app/1.0)",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    return { status: res.status, data: null };
  }
  const data = (await res.json()) as T;
  return { status: res.status, data };
}
