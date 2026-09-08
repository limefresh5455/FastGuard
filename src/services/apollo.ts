import { env } from "../config/env";
import type { PersonHit } from "../lib/extract";
import { normalizeCompanyName, normalizePhone } from "../lib/normalize";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

const CONSTRUCTION_TITLES = [
  "owner",
  "president",
  "ceo",
  "chief executive officer",
  "vice president",
  "project manager",
  "superintendent",
  "property manager",
  "director of operations",
  "project executive",
  "principal",
  "partner",
  "estimator",
];

export type ApolloCompanyHit = {
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  linkedinUrl: string | null;
  people: PersonHit[];
};

type JsonMap = Record<string, unknown>;

function asMap(v: unknown): JsonMap | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonMap) : null;
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" ? t : null;
}

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

function apolloKey(): string {
  const key = env.APOLLO_API_KEY.trim();
  if (!key) throw new Error("Apollo API key is not configured. Set APOLLO_API_KEY in .env");
  return key;
}

function revealEmails(): boolean {
  return /^(1|true|yes)$/i.test(env.APOLLO_REVEAL_EMAILS.trim());
}

function hostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function websiteFromDomain(domain?: string | null, website?: string | null): string | null {
  if (website?.startsWith("http")) return website;
  const host = hostFromUrl(website) || domain?.replace(/^www\./i, "").trim() || null;
  return host ? `https://${host}` : null;
}

function isObfuscatedName(name?: string | null): boolean {
  return Boolean(name && /\*/.test(name));
}

class ApolloHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
  }
}

function isForbidden(err: unknown): boolean {
  return err instanceof ApolloHttpError && err.status === 403;
}

async function apolloRequest(path: string, init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> }) {
  const url = new URL(`${APOLLO_BASE}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method: init.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "cache-control": "no-cache",
      "x-api-key": apolloKey(),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = asMap(data);
    const msg = firstStr(err?.message, err?.error, err?.error_message) || `Apollo ${res.status}`;
    throw new ApolloHttpError(msg, res.status, path);
  }
  return data;
}

function scopeHint(err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  throw new Error(
    `${detail} Enable these endpoints on the Apollo API key (or use a master key): mixed_companies/search or organizations/bulk_enrich, mixed_people/api_search, people/bulk_match.`,
  );
}

function orgLocation(org: JsonMap): { city: string | null; state: string | null } {
  const city = firstStr(org.city, org.organization_city, asMap(org.primary_location)?.city);
  let state = firstStr(org.state, org.organization_state, asMap(org.primary_location)?.state);
  const blob = `${firstStr(org.raw_address, org.street_address, org.country) ?? ""} ${city ?? ""} ${state ?? ""}`.toLowerCase();
  if (!state && /\bfl(orida)?\b/.test(blob)) state = "FL";
  return { city, state };
}

function orgPhone(org: JsonMap): string | null {
  const primary = asMap(org.primary_phone);
  return normalizePhone(firstStr(org.sanitized_phone, org.phone, primary?.sanitized_number, primary?.number));
}

function scoreOrganization(org: JsonMap, query: string): number {
  const name = str(org.name) ?? "";
  const n = normalizeCompanyName(name);
  const q = normalizeCompanyName(query);
  let score = 0;
  if (n && q && n === q) score += 100;
  else if (n && q && (n.includes(q) || q.includes(n))) score += 50;
  const loc = `${str(org.city) ?? ""} ${str(org.state) ?? ""} ${str(org.country) ?? ""} ${str(org.raw_address) ?? ""}`.toLowerCase();
  if (/\bflorida\b|\bmiami\b|\bfl\b/.test(loc)) score += 25;
  if (str(org.primary_domain) || str(org.website_url)) score += 10;
  return score;
}

function pickOrganization(orgs: JsonMap[], query: string): JsonMap | null {
  if (!orgs.length) return null;
  return [...orgs].sort((a, b) => scoreOrganization(b, query) - scoreOrganization(a, query))[0] ?? null;
}

async function searchOrganizations(name: string, locations?: string[]): Promise<JsonMap[]> {
  const body: JsonMap = {
    q_organization_name: name,
    page: 1,
    per_page: 10,
  };
  if (locations?.length) body.organization_locations = locations;
  const data = asMap(await apolloRequest("/mixed_companies/search", { method: "POST", body }));
  return asList(data?.organizations).map(asMap).filter((x): x is JsonMap => Boolean(x));
}

async function enrichOrganizationByName(name: string): Promise<JsonMap | null> {
  try {
    const data = asMap(
      await apolloRequest("/organizations/bulk_enrich", {
        method: "POST",
        body: { details: [{ name }] },
      }),
    );
    const orgs = asList(data?.organizations).map(asMap).filter((x): x is JsonMap => Boolean(x));
    return pickOrganization(orgs, name);
  } catch (err) {
    if (!isForbidden(err) && !(err instanceof ApolloHttpError && err.status === 422)) throw err;
  }
  const data = asMap(
    await apolloRequest("/organizations/enrich", {
      method: "GET",
      query: { name },
    }),
  );
  return asMap(data?.organization);
}

function personPhone(person: JsonMap): string | null {
  const numbers = asList(person.phone_numbers)
    .map(asMap)
    .map((n) => firstStr(n?.sanitized_number, n?.raw_number, n?.number))
    .filter(Boolean);
  return normalizePhone(firstStr(person.sanitized_phone, person.phone, ...numbers));
}

function personFromApollo(raw: JsonMap): PersonHit | null {
  const firstName = firstStr(raw.first_name);
  const lastName = firstStr(raw.last_name);
  if (isObfuscatedName(firstName) || isObfuscatedName(lastName)) return null;
  const email = firstStr(raw.email)?.toLowerCase() ?? null;
  if (email && /not_unlocked|unavailable|locked/i.test(email)) return null;
  if (!(firstName && lastName) && !email) return null;
  return {
    firstName,
    lastName,
    title: firstStr(raw.title),
    email,
    phone: personPhone(raw),
  };
}

async function searchPeople(params: {
  organizationId?: string | null;
  domain?: string | null;
  keywords?: string | null;
  titles?: string[];
}): Promise<JsonMap[]> {
  const body: JsonMap = {
    page: 1,
    per_page: 10,
    include_similar_titles: true,
  };
  if (params.organizationId) body.organization_ids = [params.organizationId];
  if (params.domain) body.q_organization_domains_list = [params.domain];
  if (params.keywords) body.q_keywords = params.keywords;
  if (params.titles?.length) body.person_titles = params.titles;
  try {
    const data = asMap(await apolloRequest("/mixed_people/api_search", { method: "POST", body }));
    return asList(data?.people).map(asMap).filter((x): x is JsonMap => Boolean(x));
  } catch (err) {
    if (!isForbidden(err)) throw err;
  }
  try {
    const data = asMap(await apolloRequest("/mixed_people/search", { method: "POST", body }));
    return asList(data?.people).map(asMap).filter((x): x is JsonMap => Boolean(x));
  } catch (err) {
    if (isForbidden(err)) return [];
    throw err;
  }
}

async function enrichPeople(people: JsonMap[], domain: string | null): Promise<JsonMap[]> {
  const details = people.slice(0, 10).map((p) => {
    const id = str(p.id);
    if (id) return { id };
    return {
      first_name: str(p.first_name),
      last_name: str(p.last_name),
      name: [str(p.first_name), str(p.last_name)].filter(Boolean).join(" ") || undefined,
      domain: domain || undefined,
    };
  });
  if (!details.length) return [];
  const query: Record<string, string> = {};
  if (revealEmails()) query.reveal_personal_emails = "true";
  try {
    const data = asMap(
      await apolloRequest("/people/bulk_match", {
        method: "POST",
        query,
        body: { details },
      }),
    );
    return asList(data?.matches).map(asMap).filter((x): x is JsonMap => Boolean(x));
  } catch (err) {
    if (isForbidden(err)) return [];
    throw err;
  }
}

export async function lookupCompanyContactsFromApollo(name: string): Promise<ApolloCompanyHit> {
  const q = name.trim();
  if (!q) throw new Error("company name is required");
  apolloKey();

  let orgs: JsonMap[] = [];
  let companyScopeBlocked = false;
  try {
    orgs = await searchOrganizations(q, ["Florida"]);
    if (!orgs.length) orgs = await searchOrganizations(q);
  } catch (err) {
    if (isForbidden(err)) companyScopeBlocked = true;
    else throw err;
  }

  let org = pickOrganization(orgs, q);
  if (!org) {
    try {
      org = await enrichOrganizationByName(q);
    } catch (err) {
      if (isForbidden(err) || (err instanceof ApolloHttpError && err.status === 422)) {
        if (isForbidden(err)) companyScopeBlocked = true;
      } else {
        throw err;
      }
    }
  }
  if (!org) {
    if (companyScopeBlocked) {
      scopeHint(new Error("This API key is not authorized to look up companies in Apollo."));
    }
    throw new Error("company not found");
  }

  const domain = firstStr(org.primary_domain) || hostFromUrl(str(org.website_url));
  const website = websiteFromDomain(domain, str(org.website_url));
  const loc = orgLocation(org);
  const orgId = str(org.id);

  let people: JsonMap[] = [];
  try {
    people = await searchPeople({ organizationId: orgId, domain, titles: CONSTRUCTION_TITLES });
    if (!people.length) people = await searchPeople({ organizationId: orgId, domain });
    if (!people.length) people = await searchPeople({ keywords: q, titles: CONSTRUCTION_TITLES });
  } catch (err) {
    scopeHint(err);
  }

  let enriched: JsonMap[] = [];
  try {
    enriched = await enrichPeople(people, domain);
  } catch {
    enriched = [];
  }

  const fromPeople = people.map((p) => asMap(p.organization)).find(Boolean);
  const resolvedOrg = org.name ? org : fromPeople || org;
  const contacts = (enriched.length ? enriched : people)
    .map(personFromApollo)
    .filter((p): p is PersonHit => Boolean(p));

  return {
    name: str(resolvedOrg.name) || q,
    domain: domain || firstStr(resolvedOrg.primary_domain) || hostFromUrl(str(resolvedOrg.website_url)),
    website: website || websiteFromDomain(null, str(resolvedOrg.website_url)),
    phone: orgPhone(resolvedOrg),
    city: loc.city,
    state: loc.state,
    linkedinUrl: str(resolvedOrg.linkedin_url),
    people: contacts,
  };
}
