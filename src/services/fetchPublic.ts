import { env } from "../config/env";
import { normalizePhone } from "../lib/normalize";
import { searchNews } from "./newsSearch";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SKIP_HOST = /google\.|facebook\.|linkedin\.|twitter\.|x\.com|instagram\./i;
export const PRESS_HOST = /prnewswire|businesswire|globenewswire|newswire\.com|news\.google/i;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function emailsInText(text: string): string[] {
  const found = text.match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))].filter(
    (e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.includes("example.com") && !e.includes("sentry.io"),
  );
}

export function phonesInText(text: string): string[] {
  const raw = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g) ?? [];
  return [...new Set(raw.map((p) => normalizePhone(p)).filter(Boolean) as string[])];
}

export async function fetchPublicPage(url: string): Promise<{ url: string; text: string } | null> {
  if (!url.startsWith("http")) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": env.CRAWLER_USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const finalUrl = res.url || url;
    if (SKIP_HOST.test(finalUrl)) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!/html|text|xml/i.test(ctype) && ctype) return null;
    const html = (await res.text()).slice(0, 250_000);
    const text = stripHtml(html).slice(0, 14000);
    if (text.length < 40) return null;
    return { url: finalUrl, text };
  } catch {
    return null;
  }
}

export function isOfficialWebsite(url?: string | null): boolean {
  if (!url?.startsWith("http")) return false;
  return !SKIP_HOST.test(url) && !PRESS_HOST.test(url) && !/duckduckgo\.com/i.test(url);
}

export function websitePageUrls(website?: string | null): string[] {
  if (!website) return [];
  const base = website.startsWith("http") ? website : `https://${website}`;
  const root = base.replace(/\/$/, "");
  return [root, `${root}/contact`, `${root}/about`, `${root}/team`];
}

export function websiteFromEmail(email?: string | null): string | null {
  if (!email?.includes("@")) return null;
  const host = email.split("@")[1]?.toLowerCase();
  if (!host || /gmail|yahoo|hotmail|outlook|aol|icloud/.test(host)) return null;
  return `https://${host}`;
}

export async function searchHomepageUrls(companyName: string): Promise<string[]> {
  const q = `${companyName} official website South Florida`;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": env.CRAWLER_USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const encoded = [...html.matchAll(/uddg=([^&"]+)/g)].map((m) => {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return "";
      }
    });
    const hrefs = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);
    return [...new Set([...encoded, ...hrefs])].filter((u) => isOfficialWebsite(u)).slice(0, 4);
  } catch {
    return [];
  }
}

export async function gatherSourceText(urls: Array<string | null | undefined>): Promise<{ urls: string[]; text: string }> {
  const unique = [...new Set(urls.filter(Boolean) as string[])];
  const parts: string[] = [];
  const used: string[] = [];
  for (const url of unique.slice(0, 8)) {
    const page = await fetchPublicPage(url);
    if (!page) continue;
    used.push(page.url);
    parts.push(`SOURCE ${page.url}\n${page.text}`);
  }
  return { urls: used, text: parts.join("\n\n").slice(0, 20000) };
}

export async function gatherCompanyIntel(params: {
  name: string;
  website?: string | null;
  city?: string | null;
  extraUrls?: Array<string | null | undefined>;
}): Promise<{ text: string; urls: string[]; website: string | null }> {
  const city = params.city?.trim() || "South Florida";
  const homepages = await searchHomepageUrls(params.name);
  const news = await searchNews(
    [
      `"${params.name}" official website`,
      `"${params.name}" contact email phone`,
      `"${params.name}" ${city} under construction`,
      `"${params.name}" ${city} groundbreaking`,
      `"${params.name}" ${city} construction`,
    ],
    4,
  );
  const knownSite = [params.website, ...homepages].find((u) => isOfficialWebsite(u ?? null)) ?? null;
  const gathered = await gatherSourceText([
    ...websitePageUrls(knownSite),
    ...homepages,
    ...(params.extraUrls ?? []),
    ...news.map((n) => n.link),
  ]);
  const text = [
    `Company: ${params.name}. Location: ${city}. Website: ${knownSite || "unknown"}.`,
    "Determine whether this company has a construction project currently underway or starting soon.",
    "Extract real people only (firstName, lastName, title, email, phone). Do not treat the company name as a contact.",
    news.map((n) => `${n.title}\n${n.description}\n${n.link}`).join("\n"),
    gathered.text,
  ].join("\n\n");
  return { text, urls: gathered.urls, website: knownSite };
}
