import { env } from "../config/env";

export interface NewsItem {
  title: string;
  link: string;
  description: string;
}

function googleNewsRss(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function inner(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return (m?.[1] || m?.[2] || "").trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function parseRss(xml: string): NewsItem[] {
  return xml
    .split(/<item[\s>]/i)
    .slice(1)
    .map((block) => ({
      title: decodeXml(inner(block, "title")),
      link: decodeXml(inner(block, "link") || inner(block, "guid")),
      description: decodeXml(inner(block, "description")),
    }))
    .filter((i) => i.title && i.link.startsWith("http"));
}

export async function searchNews(queries: string[], perQuery = 6): Promise<NewsItem[]> {
  const seen = new Set<string>();
  const hits: NewsItem[] = [];
  for (const q of queries) {
    try {
      const res = await fetch(googleNewsRss(q), {
        headers: { "User-Agent": env.CRAWLER_USER_AGENT, Accept: "application/rss+xml" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      for (const item of parseRss(await res.text()).slice(0, perQuery)) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        hits.push(item);
      }
    } catch {
      /* skip query */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return hits;
}
