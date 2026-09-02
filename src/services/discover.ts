import { env } from "../config/env";
import { prisma } from "../db/client";
import { inferNewsProjectStage, isActiveConstructionStage } from "../lib/constructionFit";
import { companyNameFromNews } from "../lib/extract";
import { normalizeCompanyName } from "../lib/normalize";
import { scoreLead } from "../scoring/scoreLead";
import { bumpSource } from "./sources";

export interface NewsHit {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  city: string;
  source: "construction_news";
}

const CONSTRUCTION_QUERIES = [
  "under construction",
  "construction underway",
  "groundbreaking",
  "breaks ground",
  "construction to begin",
  "building permit issued",
  "multifamily construction",
  "general contractor awarded",
];

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

function parseRss(xml: string): Array<{ title: string; link: string; description: string; pubDate?: string }> {
  return xml
    .split(/<item[\s>]/i)
    .slice(1)
    .map((block) => ({
      title: decodeXml(inner(block, "title")),
      link: decodeXml(inner(block, "link") || inner(block, "guid")),
      description: decodeXml(inner(block, "description")),
      pubDate: inner(block, "pubDate"),
    }))
    .filter((i) => i.title && i.link.startsWith("http"));
}

function inferTrigger(text: string): string {
  const t = text.toLowerCase();
  if (/groundbreaking|breaks ground/.test(t)) return "groundbreaking";
  if (/permit/.test(t)) return "permit";
  if (/theft|vandal/.test(t)) return "security_incident";
  if (/acquisit|takeover/.test(t)) return "property_acquisition";
  return "project_signal";
}

async function fetchHits(location: string): Promise<NewsHit[]> {
  const hits: NewsHit[] = [];
  const seen = new Set<string>();
  const jobs: Array<{ q: string; source: NewsHit["source"] }> = CONSTRUCTION_QUERIES.map((phrase) => ({
    q: `${phrase} ${location}`,
    source: "construction_news" as const,
  }));
  for (const job of jobs) {
    const res = await fetch(googleNewsRss(job.q), {
      headers: { "User-Agent": env.CRAWLER_USER_AGENT, Accept: "application/rss+xml" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) continue;
    const items = parseRss(await res.text());
    for (const item of items.slice(0, 8)) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      hits.push({ ...item, city: location, source: job.source });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return hits;
}

export async function discoverByLocation(location: string) {
  const hits = await fetchHits(location);
  let created = 0;
  let skipped = 0;

  for (const hit of hits) {
    const projectStage = inferNewsProjectStage(hit.title, hit.description);
    if (!isActiveConstructionStage(projectStage)) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.lead.findFirst({ where: { source: hit.source, project: { sourceUrl: hit.link } } });
    if (existing) {
      skipped += 1;
      continue;
    }
    const companyName = companyNameFromNews(hit.title, hit.description);
    const normalizedName = normalizeCompanyName(companyName);
    let company = await prisma.company.findFirst({ where: { normalizedName } });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: companyName,
          normalizedName,
          city: hit.city,
          state: "FL",
          sourceUrl: hit.link,
          companyType: "CONSTRUCTION_COMPANY",
        },
      });
    }
    const project = await prisma.project.create({
      data: {
        companyId: company.id,
        name: hit.title.slice(0, 180),
        city: hit.city,
        state: "FL",
        sourceUrl: hit.link,
        projectType: "UNKNOWN",
        projectStage,
      },
    });
    const trigger = await prisma.triggerEvent.create({
      data: {
        companyId: company.id,
        projectId: project.id,
        triggerType: inferTrigger(`${hit.title} ${hit.description}`),
        triggerDate: hit.pubDate ? new Date(hit.pubDate) : new Date(),
        headline: hit.title,
        sourceUrl: hit.link,
      },
    });
    const scored = scoreLead({
      hasCompany: true,
      hasPersonContact: false,
      hasPhoneOrEmail: false,
      hasProject: true,
      hasTrigger: true,
      companyType: company.companyType,
    });
    await prisma.lead.create({
      data: {
        companyId: company.id,
        projectId: project.id,
        triggerId: trigger.id,
        score: scored.total,
        recommendedService: "Construction Site Security",
        source: hit.source,
        status: "DISCOVERED",
      },
    });
    created += 1;
  }

  await bumpSource("construction_news", `${location} construction news`, "news", created);
  return { found: hits.length, created, skipped, location };
}
