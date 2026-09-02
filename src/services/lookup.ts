import { prisma } from "../db/client";
import { resolveConstructionStage } from "../lib/constructionFit";
import { classifyLead, extractPlaceEntities } from "../llm/classify";
import { normalizeCompanyName } from "../lib/normalize";
import { isPersonName, scoreLead } from "../scoring/scoreLead";
import { persistContactsForCompany, syncProjectFromClassification } from "./enrich";
import { gatherCompanyIntel, gatherSourceText, websitePageUrls } from "./fetchPublic";
import { searchNews } from "./newsSearch";
import { bumpSource, seedDefaultSources } from "./sources";

async function upsertCompany(name: string, extra: { website?: string | null; city?: string | null; state?: string | null }) {
  const normalizedName = normalizeCompanyName(name) || name.toLowerCase();
  const found = await prisma.company.findFirst({ where: { normalizedName } });
  if (found) {
    return prisma.company.update({
      where: { id: found.id },
      data: {
        website: extra.website || found.website,
        city: extra.city || found.city,
        state: extra.state || found.state,
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

export async function findCompanyByName(name: string) {
  const q = name.trim();
  if (!q) throw new Error("company name is required");
  const normalized = normalizeCompanyName(q) || q.toLowerCase();

  const matches = await prisma.company.findMany({
    where: {
      OR: [
        { normalizedName: normalized },
        { name: { contains: q, mode: "insensitive" } },
        { normalizedName: { contains: normalized, mode: "insensitive" } },
      ],
    },
    take: 10,
    orderBy: { name: "asc" },
  });
  matches.sort((a, b) => {
    const aExact = a.normalizedName === normalized ? 0 : 1;
    const bExact = b.normalizedName === normalized ? 0 : 1;
    return aExact - bExact;
  });

  let company: (typeof matches)[0] | undefined = matches[0];
  const result = await enrichByCompany({
    name: q,
    website: company?.website ?? undefined,
    city: company?.city || "South Florida",
    state: company?.state || "FL",
  });
  company =
    (result.company?.id
      ? await prisma.company.findUnique({ where: { id: result.company.id } })
      : null) ??
    (await prisma.company.findFirst({ where: { normalizedName: normalized } })) ??
    (await prisma.company.findFirst({ where: { name: { contains: q, mode: "insensitive" } } })) ??
    undefined;

  if (!company) throw new Error("company not found");
  const card = await loadCompanyCard(company.id);
  if (!card) throw new Error("company not found");
  const others = matches.filter((m) => m.id !== company.id).map((m) => ({ id: m.id, name: m.name }));
  return { query: q, enriched: true, contactsSaved: result.contactsSaved, ...card, otherMatches: others };
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
