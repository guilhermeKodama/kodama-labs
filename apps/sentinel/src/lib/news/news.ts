import sourcesConfig from "./news-sources.json";

const ALLOWLIST = sourcesConfig.sources as Record<string, string>;

/** Credibility tier for a publisher, from the curated allowlist (UNKNOWN if absent). */
export function sourceCredibility(source: string): string {
  const key = source.trim().toLowerCase();
  return ALLOWLIST[key] ?? "UNKNOWN";
}

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]!) : null;
}

/**
 * Fetches recent news for a query via the Google News RSS feed (no API key) and
 * parses the items. RSS is small XML, parsed with bounded regex to avoid adding
 * an XML dependency. Returns [] on any failure (best-effort).
 */
export async function fetchPoliticianNews(
  query: string,
  max = 15,
): Promise<NewsArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
      });
      if (!res.ok) {
        if (attempt === maxRetries) return [];
        await sleep(attempt * 3000);
        continue;
      }
      const xml = await res.text();
      const items = xml.split("<item>").slice(1, max + 1);
      const articles: NewsArticle[] = [];
      for (const item of items) {
        const title = extractTag(item, "title");
        const link = extractTag(item, "link");
        const pubDate = extractTag(item, "pubDate");
        const source = extractTag(item, "source");
        if (!title || !link) continue;
        let publishedAt: string | null = null;
        if (pubDate) {
          const d = new Date(pubDate);
          if (!isNaN(d.getTime())) publishedAt = d.toISOString();
        }
        articles.push({
          title,
          url: link,
          source: source ?? "",
          publishedAt,
        });
      }
      return articles;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries) {
        console.warn(
          `[news] fetch failed for "${query}":`,
          err instanceof Error ? err.message : err,
        );
        return [];
      }
      await sleep(attempt * 3000);
    } finally {
      clearTimeout(timeout);
    }
  }
  return [];
}
