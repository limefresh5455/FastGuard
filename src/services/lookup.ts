import { prisma } from "../db/client";
import { resolveConstructionStage } from "../lib/constructionFit";
import { classifyLead, extractPlaceEntities } from "../llm/classify";
import { extractCompanyLookupCandidates, looksLikeNewsHeadline, moneyInText } from "../lib/extract";
import { normalizeCompanyName } from "../lib/normalize";
import { isPersonName, scoreLead } from "../scoring/scoreLead";
import { lookupCompanyContactsFromApolloCandidates, type ApolloCompanyHit } from "./apollo";
import { persistContactsForCompany, syncProjectFromClassification } from "./enrich";
import { gatherCompanyIntel, gatherSourceText, websitePageUrls } from "./fetchPublic";
import { searchNews } from "./newsSearch";
import { bumpSource, seedDefaultSources } from "./sources";

async function upsertCompany(name: string, extra: {
  website?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  sourceUrl?: string | null;
}) {
  const normalizedName = normalizeCompanyName(name) || name.toLowerCase();
  const found = await prisma.company.findFirst({ where: { normalizedName } });
  if (found) {
    return prisma.company.update({
      where: { id: found.id },
      data: {
        website: extra.website || found.website,
        city: extra.city || found.city,
        state: extra.state || found.state,
        phone: extra.phone || found.phone,
        sourceUrl: extra.sourceUrl || found.sourceUrl,
      },
    });
  }
  return prisma.company.create({
    data: {
      name,
      normalizedName,
      website: extra.website,
      city: extra.city,
      state: extra.state ?? "FL",
      phone: extra.phone,
      sourceUrl: extra.sourceUrl,
    },
  });
}

async function finalizeLead(params: {
  companyId: string;
  contactId: string | null;
  projectId?: string;
  triggerId?: string;
  source: string;
  companyTypeHint?: string;
}) {
  const company = await prisma.company.findUnique({ where: { id: params.companyId } });
  const contact = params.contactId ? await prisma.contact.findUnique({ where: { id: params.contactId } }) : null;
  const project = params.projectId ? await prisma.project.findUnique({ where: { id: params.projectId } }) : null;
  const classified = await classifyLead({ company, contact, project, source: params.source });
  const projectId = await syncProjectFromClassification({
    companyId: params.companyId,
    companyName: company?.name || "construction",
    projectId: params.projectId,
    city: company?.city,
    state: company?.state,
    classified,
  });
  const scored = scoreLead({
    hasCompany: true,
    hasPersonContact: isPersonName(contact?.firstName, contact?.lastName),
    hasPhoneOrEmail: Boolean(contact?.phone || contact?.email || company?.phone),
    hasProject: Boolean(projectId),
    hasTrigger: Boolean(params.triggerId),
    companyType: classified.company_type,
    aiScore: classified.exclude ? 0 : classified.score,
  });
  await prisma.company.update({
    where: { id: params.companyId },
    data: { companyType: classified.company_type },
  });
  const existing = await prisma.lead.findFirst({
    where: {
      companyId: params.companyId,
      source: params.source,
      ...(projectId ? { projectId } : {}),
    },
  });
  const data = {
    companyId: params.companyId,
    contactId: params.contactId,
    projectId,
    triggerId: params.triggerId,
    score: scored.total,
    recommendedService: classified.recommended_service,
    source: params.source,
    classified: true,
    status: classified.exclude ? "EXCLUDED" : scored.total >= 60 ? "QUALIFIED" : "RESEARCHED",
  };
  const lead = existing
    ? await prisma.lead.update({ where: { id: existing.id }, data })
    : await prisma.lead.create({ data });
  return { lead, classified, score: scored.total };
}

export async function enrichByCompany(input: {
  name: string;
  website?: string;
  city?: string;
  state?: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("company name is required");
  const city = input.city?.trim() || "Miami";
  const state = input.state?.trim() || "FL";
  const website = input.website?.trim();

  const company = await upsertCompany(name, { website, city, state });
  const intel = await gatherCompanyIntel({
    name,
    website: website || company.website,
    city,
    extraUrls: [company.sourceUrl],
  });
  const pageText = intel.text;

  const { contactId, saved } = await persistContactsForCompany({
    companyId: company.id,
    companyName: name,
    website: intel.website || website || company.website,
    phone: company.phone,
    sourceUrls: intel.urls,
    pageText,
    extraPeople: intel.people,
  });

  const { lead } = await finalizeLead({
    companyId: company.id,
    contactId,
    source: "lookup_company",
  });

  await seedDefaultSources();
  await bumpSource("lookup_company", "Manual company lookup", "lookup", 1);
  const fresh = await prisma.company.findUnique({ where: { id: company.id } });
  const contacts = await prisma.contact.findMany({ where: { companyId: company.id } });
  return {
    query: { name, website, city, state },
    company: fresh,
    contacts,
    contactsSaved: saved,
    leadId: lead.id,
    score: lead.score,
    recommendedService: lead.recommendedService,
    sources: intel.urls,
  };
}

async function loadCompanyCard(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return null;
  const [contacts, projects, triggers, lead] = await Promise.all([
    prisma.contact.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.triggerEvent.findMany({ where: { companyId }, orderBy: { triggerDate: "desc" }, take: 20 }),
    prisma.lead.findFirst({ where: { companyId }, orderBy: { score: "desc" } }),
  ]);
  return {
    company: {
      id: company.id,
      name: company.name,
      companyType: company.companyType,
      website: company.website,
      phone: company.phone,
      address: company.address,
      city: company.city,
      state: company.state,
    },
    contacts: contacts.map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
      title: c.title,
      email: c.email,
      phone: c.phone,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      address: [p.address, p.city, p.state].filter(Boolean).join(", ") || null,
      type: p.projectType,
      stage: p.projectStage,
    })),
    triggers: triggers.map((t) => ({
      id: t.id,
      type: t.triggerType,
      headline: t.headline,
      date: t.triggerDate,
      sourceUrl: t.sourceUrl,
    })),
    lead: lead
      ? {
          id: lead.id,
          score: lead.score,
          recommendedService: lead.recommendedService,
          source: lead.source,
          status: lead.status,
        }
      : null,
  };
}

function hostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

async function lookupCompanyByLlm(params: {
  name: string;
  description: string;
  existing: {
    id: string;
    name: string;
    normalizedName: string;
    website: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    sourceUrl: string | null;
    triggers: Array<{ headline: string; sourceUrl: string }>;
    projects: Array<{ id: string }>;
  } | null;
}) {
  const candidates = extractCompanyLookupCandidates(params.name, params.description);
  const resolvedName =
    candidates.find((c) => !looksLikeNewsHeadline(c)) || candidates[0] || params.name;
  const city = params.existing?.city || "South Florida";
  const state = params.existing?.state || "FL";
  const triggerUrls = params.existing?.triggers.map((t) => t.sourceUrl).filter(Boolean) ?? [];

  const intel = await gatherCompanyIntel({
    name: resolvedName,
    website: params.existing?.website,
    city,
    extraUrls: [params.existing?.sourceUrl, ...triggerUrls],
  });

  const pageText = [params.description, params.name !== params.description ? params.name : "", intel.text]
    .filter(Boolean)
    .join("\n\n");

  let companyRecord;
  if (params.existing) {
    const headlineName = looksLikeNewsHeadline(params.existing.name);
    companyRecord = await prisma.company.update({
      where: { id: params.existing.id },
      data: {
        ...(headlineName && resolvedName !== params.existing.name
          ? { name: resolvedName, normalizedName: normalizeCompanyName(resolvedName) }
          : {}),
        website: intel.website || params.existing.website,
        city: params.existing.city || city,
        state: params.existing.state || state,
        sourceUrl: params.existing.sourceUrl || triggerUrls[0] || intel.urls[0],
      },
    });
  } else {
    companyRecord = await upsertCompany(resolvedName, {
      city,
      state,
      website: intel.website,
      sourceUrl: triggerUrls[0] || intel.urls[0],
    });
  }

  const { contactId, saved, profile } = await persistContactsForCompany({
    companyId: companyRecord.id,
    companyName: resolvedName,
    website: intel.website || companyRecord.website,
    phone: companyRecord.phone,
    sourceUrls: intel.urls,
    pageText,
    extraPeople: intel.people,
  });

  const linked = contactId ? await prisma.contact.findUnique({ where: { id: contactId } }) : null;
  const classified = await classifyLead({
    company: companyRecord,
    contact: linked,
    project: null,
    source: "llm_lookup",
    extractedPagePreview: pageText.slice(0, 4000),
    extractedProfile: {
      company_name: profile.company_name,
      project_name: profile.project_name,
      project_stage: profile.project_stage,
      project_type: profile.project_type,
    },
  });

  await syncProjectFromClassification({
    companyId: companyRecord.id,
    companyName: profile.company_name || resolvedName,
    projectId: params.existing?.projects[0]?.id,
    city: profile.project_city || companyRecord.city,
    state: companyRecord.state,
    classified,
    extras: {
      name: profile.project_name,
      address: profile.project_address,
      city: profile.project_city,
      projectType: profile.project_type,
      projectStage: profile.project_stage,
      projectValue: profile.project_value ?? moneyInText(pageText),
      sourceUrl: intel.urls[0],
    },
  });

  const { lead } = await finalizeLead({
    companyId: companyRecord.id,
    contactId,
    source: "llm_lookup",
  });

  await seedDefaultSources();
  await bumpSource("llm_lookup", "LLM company lookup (Apollo fallback)", "lookup", 1);

  const card = await loadCompanyCard(companyRecord.id);
  if (!card) throw new Error("company not found");

  return {
    query: params.name,
    resolvedQuery: profile.company_name || resolvedName,
    description: params.description || null,
    enriched: true,
    source: "llm",
    domain: hostFromUrl(intel.website || companyRecord.website),
    contactsSaved: saved,
    leadId: lead.id,
    score: lead.score,
    ...card,
    otherMatches: [],
  };
}

export async function findCompanyByName(input: string | { name?: string; description?: string; companyId?: string }) {
  const opts = typeof input === "string" ? { name: input } : input;
  let name = opts.name?.trim() ?? "";
  let description = opts.description?.trim() ?? "";

  const existing = opts.companyId
    ? await prisma.company.findUnique({
        where: { id: opts.companyId },
        include: {
          triggers: { orderBy: { triggerDate: "desc" }, take: 5 },
          projects: { orderBy: { createdAt: "desc" }, take: 3 },
        },
      })
    : null;

  if (existing) {
    if (!name) name = existing.name;
    if (!description) {
      description = [
        ...existing.triggers.map((t) => t.headline),
        ...existing.projects.map((p) => p.name),
      ]
        .filter(Boolean)
        .join(". ");
    }
  }

  if (!name && !description) throw new Error("company name is required");
  if (!description) description = name;

  let candidates = extractCompanyLookupCandidates(name, description);
  if (!candidates.length && name) candidates = [name];

  let apollo: ApolloCompanyHit | null = null;
  let resolvedQuery = name;
  try {
    const out = await lookupCompanyContactsFromApolloCandidates(candidates);
    apollo = out.hit;
    resolvedQuery = out.query;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== "company not found") throw err;
    try {
      const place = await extractPlaceEntities({
        address: name || "South Florida",
        sourceText: `${name}. ${description}`,
      });
      const llmCandidates = place.companies.map((c) => c.name).filter(Boolean);
      if (llmCandidates.length) {
        const out = await lookupCompanyContactsFromApolloCandidates(llmCandidates);
        apollo = out.hit;
        resolvedQuery = out.query;
      }
    } catch {
      /* fall through to full LLM lookup */
    }
  }

  if (!apollo) {
    return lookupCompanyByLlm({ name, description, existing });
  }

  const apolloNorm = normalizeCompanyName(apollo.name) || apollo.name.toLowerCase();
  const queryNorm = normalizeCompanyName(resolvedQuery) || resolvedQuery.toLowerCase();

  const matches = await prisma.company.findMany({
    where: {
      OR: [
        ...(existing ? [{ id: existing.id }] : []),
        { normalizedName: apolloNorm },
        { normalizedName: queryNorm },
        ...(name ? [{ name: { contains: name, mode: "insensitive" as const } }] : []),
        { name: { contains: apollo.name, mode: "insensitive" as const } },
      ],
    },
    take: 10,
    orderBy: { name: "asc" },
  });
  matches.sort((a, b) => {
    if (existing && a.id === existing.id) return -1;
    if (existing && b.id === existing.id) return 1;
    const aExact = a.normalizedName === apolloNorm || a.normalizedName === queryNorm ? 0 : 1;
    const bExact = b.normalizedName === apolloNorm || b.normalizedName === queryNorm ? 0 : 1;
    return aExact - bExact;
  });

  const extra = {
    website: apollo.website,
    city: apollo.city || existing?.city || "South Florida",
    state: apollo.state || existing?.state || "FL",
    phone: apollo.phone,
    sourceUrl: apollo.linkedinUrl || apollo.website,
  };
  const headlineName = existing?.name && looksLikeNewsHeadline(existing.name);
  const company = matches[0]
    ? await prisma.company.update({
        where: { id: matches[0].id },
        data: {
          name: headlineName ? apollo.name : matches[0].name,
          normalizedName: headlineName ? apolloNorm : matches[0].normalizedName,
          website: extra.website || matches[0].website,
          city: extra.city || matches[0].city,
          state: extra.state || matches[0].state,
          phone: extra.phone || matches[0].phone,
          sourceUrl: extra.sourceUrl || matches[0].sourceUrl,
        },
      })
    : await upsertCompany(apollo.name, extra);

  const sourceUrls = [apollo.linkedinUrl, extra.website].filter((u): u is string => Boolean(u));
  const { contactId, saved } = await persistContactsForCompany({
    companyId: company.id,
    companyName: apollo.name,
    website: extra.website || company.website,
    phone: extra.phone || company.phone,
    sourceUrls,
    pageText: description,
    extraPeople: apollo.people,
  });

  const { lead } = await finalizeLead({
    companyId: company.id,
    contactId,
    source: "apollo_lookup",
  });

  await seedDefaultSources();
  await bumpSource("apollo_lookup", "Apollo company lookup", "lookup", 1);

  const card = await loadCompanyCard(company.id);
  if (!card) throw new Error("company not found");
  const others = matches.filter((m) => m.id !== company.id).map((m) => ({ id: m.id, name: m.name }));
  return {
    query: name || resolvedQuery,
    resolvedQuery,
    description: description || null,
    enriched: true,
    source: "apollo",
    domain: apollo.domain,
    contactsSaved: saved,
    leadId: lead.id,
    score: lead.score,
    ...card,
    otherMatches: others,
  };
}

export async function enrichByAddress(input: { address: string; city?: string; state?: string }) {
  const address = input.address.trim();
  if (!address) throw new Error("address is required");
  const city = input.city?.trim() || "Miami";
  const state = input.state?.trim() || "FL";
  const label = `${address}, ${city}, ${state}`;

  const news = await searchNews(
    [
      `"${address}" ${city} ${state} under construction`,
      `"${address}" ${city} groundbreaking`,
      `"${address}" ${city} general contractor`,
      `"${address}" ${city} building permit`,
    ],
    5,
  );
  const gathered = await gatherSourceText(news.map((n) => n.link));
  const sourceText = [
    `Address lookup: ${label}`,
    news.map((n) => `${n.title}\n${n.description}\n${n.link}`).join("\n"),
    gathered.text,
  ].join("\n\n");

  const place = await extractPlaceEntities({ address: label, sourceText });
  const primaryName = place.companies[0]?.name || `Property at ${address}`;
  const company = await upsertCompany(primaryName, {
    website: place.companies[0]?.website,
    city,
    state,
  });

  const project = await prisma.project.create({
    data: {
      companyId: company.id,
      name: place.project_name || label,
      address,
      city,
      state,
      projectType: place.project_type,
      projectStage: resolveConstructionStage(place.project_stage, sourceText),
      sourceUrl: gathered.urls[0] || news[0]?.link,
    },
  });

  const trigger = await prisma.triggerEvent.create({
    data: {
      companyId: company.id,
      projectId: project.id,
      triggerType: "address_lookup",
      triggerDate: new Date(),
      headline: `Lookup: ${label}`,
      sourceUrl: gathered.urls[0] || news[0]?.link || `https://example.com/lookup/${encodeURIComponent(address)}`,
    },
  });

  const extraCompanies = [];
  for (const org of place.companies.slice(1)) {
    const other = await upsertCompany(org.name, { website: org.website, city, state });
    extraCompanies.push({ id: other.id, name: other.name, relationship: org.relationship });
    await persistContactsForCompany({
      companyId: other.id,
      companyName: org.name,
      website: org.website,
      phone: null,
      sourceUrls: gathered.urls,
      pageText: sourceText,
      extraPeople: gathered.people,
    });
  }

  const { contactId, saved } = await persistContactsForCompany({
    companyId: company.id,
    companyName: company.name,
    website: company.website,
    phone: company.phone,
    sourceUrls: gathered.urls,
    pageText: sourceText,
    extraPeople: gathered.people,
  });

  const { lead } = await finalizeLead({
    companyId: company.id,
    contactId,
    projectId: project.id,
    triggerId: trigger.id,
    source: "lookup_address",
  });

  await seedDefaultSources();
  await bumpSource("lookup_address", "Manual address lookup", "lookup", 1);
  const contacts = await prisma.contact.findMany({ where: { companyId: company.id } });
  const freshCompany = await prisma.company.findUnique({ where: { id: company.id } });
  return {
    query: { address, city, state },
    company: freshCompany,
    project,
    contacts,
    contactsSaved: saved,
    relatedCompanies: extraCompanies,
    leadId: lead.id,
    score: lead.score,
    recommendedService: lead.recommendedService,
    sources: gathered.urls,
  };
}

export async function discoverSignals(input: {
  name?: string;
  address?: string;
  website?: string;
  city?: string;
  state?: string;
}) {
  const name = input.name?.trim();
  const address = input.address?.trim();
  const website = input.website?.trim();
  const city = input.city?.trim() || "Miami";
  const state = input.state?.trim() || "FL";

  if (!name && !address) {
    throw new Error("Fill company name and/or street address");
  }
  if (name && !address) {
    const result = await enrichByCompany({ name, website, city, state });
    return { mode: "company_name", location: "South Florida", ...result };
  }
  if (address && !name) {
    const result = await enrichByAddress({ address, city, state });
    return { mode: "address", location: "South Florida", ...result };
  }

  const company = await upsertCompany(name!, { website, city, state });
  const queries = [
    `"${name}" "${address}" ${city} ${state} under construction`,
    `"${name}" ${city} groundbreaking`,
    `"${address}" ${city} construction underway`,
    `"${name}" ${city} general contractor`,
  ];
  const news = await searchNews(queries, 6);
  const gathered = await gatherSourceText([...websitePageUrls(website || company.website), ...news.map((n) => n.link)]);
  const sourceText = [
    `South Florida construction/property lookup. Company: ${name}. Address: ${address}, ${city}, ${state}.`,
    news.map((n) => `${n.title}\n${n.description}\n${n.link}`).join("\n"),
    gathered.text,
  ].join("\n\n");

  const place = await extractPlaceEntities({ address: `${address}, ${city}, ${state}`, sourceText });
  const project = await prisma.project.create({
    data: {
      companyId: company.id,
      name: place.project_name || `${name} — ${address}`,
      address,
      city,
      state,
      projectType: place.project_type,
      projectStage: resolveConstructionStage(place.project_stage, sourceText),
      sourceUrl: gathered.urls[0] || news[0]?.link,
    },
  });
  const trigger = await prisma.triggerEvent.create({
    data: {
      companyId: company.id,
      projectId: project.id,
      triggerType: "construction_property_signal",
      triggerDate: new Date(),
      headline: `${name} @ ${address}, ${city}`,
      sourceUrl: gathered.urls[0] || news[0]?.link || `https://example.com/discover/${encodeURIComponent(address ?? "")}`,
    },
  });

  const { contactId, saved } = await persistContactsForCompany({
    companyId: company.id,
    companyName: name!,
    website: website || company.website,
    phone: company.phone,
    sourceUrls: gathered.urls,
    pageText: sourceText,
    extraPeople: gathered.people,
  });

  const relatedCompanies: Array<{ id: string; name: string; relationship: string | null | undefined }> = [];
  for (const org of place.companies) {
    if (normalizeCompanyName(org.name) === normalizeCompanyName(name!)) continue;
    const other = await upsertCompany(org.name, { website: org.website, city, state });
    relatedCompanies.push({ id: other.id, name: other.name, relationship: org.relationship });
    await persistContactsForCompany({
      companyId: other.id,
      companyName: org.name,
      website: org.website,
      phone: null,
      sourceUrls: gathered.urls,
      pageText: sourceText,
      extraPeople: gathered.people,
    });
  }

  const { lead } = await finalizeLead({
    companyId: company.id,
    contactId,
    projectId: project.id,
    triggerId: trigger.id,
    source: "discover_signal",
  });

  await seedDefaultSources();
  await bumpSource("discover_signal", "Name + address discover", "news", 1);
  const contacts = await prisma.contact.findMany({ where: { companyId: company.id } });
  const freshCompany = await prisma.company.findUnique({ where: { id: company.id } });
  return {
    mode: "name_and_address",
    location: "South Florida",
    query: { name, address, website, city, state },
    company: freshCompany,
    project,
    contacts,
    contactsSaved: saved,
    relatedCompanies,
    leadId: lead.id,
    score: lead.score,
    recommendedService: lead.recommendedService,
    sources: gathered.urls,
  };
}
