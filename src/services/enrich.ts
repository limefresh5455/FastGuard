import { prisma } from "../db/client";
import { isActiveConstructionStage, normalizeProjectStage } from "../lib/constructionFit";
import {
  cityFromText,
  isGenericEmail,
  looksLikeNewsHeadline,
  mergePeople,
  moneyInText,
  nameFromEmail,
  peopleFromText,
  SOUTH_FL_CITIES,
  splitFullName,
  type PersonHit,
} from "../lib/extract";
import { classifyLead, extractContactsFromText, type ClassifyResult, type ExtractedContacts } from "../llm/classify";
import { looksLikeCompanyAsContactName, normalizeCompanyName, normalizePhone } from "../lib/normalize";
import { isPersonName, scoreLead } from "../scoring/scoreLead";
import {
  emailsInText,
  gatherCompanyIntel,
  isOfficialWebsite,
  phonesInText,
  websiteFromEmail,
} from "./fetchPublic";

const include = {
  company: true,
  contact: true,
  project: true,
  trigger: true,
} as const;

const TITLE_RANK = [
  "superintendent",
  "project manager",
  "property manager",
  "director of operations",
  "project executive",
  "owner",
  "president",
];

function rankTitle(title?: string | null): number {
  const t = (title ?? "").toLowerCase();
  const i = TITLE_RANK.findIndex((k) => t.includes(k));
  return i === -1 ? 99 : i;
}

function splitPersonName(first?: string | null, last?: string | null): { firstName: string | null; lastName: string | null; title: string | null } {
  if (first && last) {
    const titled = splitFullName(`${first} ${last}`);
    return { firstName: titled.firstName || first, lastName: titled.lastName || last, title: titled.title };
  }
  return splitFullName(first || last || "");
}

function contactLabel(first?: string | null, last?: string | null): string {
  return `${first ?? ""} ${last ?? ""}`.trim();
}

function isCompanyNameContact(personName: string, companyName: string): boolean {
  const person = normalizeCompanyName(personName);
  const company = normalizeCompanyName(companyName);
  if (!person) return true;
  if (looksLikeCompanyAsContactName(personName) && !personName.includes("@")) return true;
  if (!company) return false;
  if (person === company) return true;
  if (company.startsWith(person) && person.split(" ").length >= 2) return true;
  if (person.startsWith(company) && company.split(" ").length >= 2) return true;
  return false;
}

async function findExistingContact(
  companyId: string,
  data: { email: string | null; firstName: string | null; lastName: string | null },
) {
  if (data.email) {
    const byEmail = await prisma.contact.findFirst({ where: { companyId, email: data.email } });
    if (byEmail) return byEmail;
  }
  if (data.firstName && data.lastName) {
    return prisma.contact.findFirst({
      where: {
        companyId,
        firstName: { equals: data.firstName, mode: "insensitive" },
        lastName: { equals: data.lastName, mode: "insensitive" },
      },
    });
  }
  return null;
}

async function upsertContact(
  companyId: string,
  companyName: string,
  data: {
    firstName?: string | null;
    lastName?: string | null;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    sourceUrl?: string | null;
  },
): Promise<string | null> {
  const email = data.email?.toLowerCase().trim() || null;
  if (email && /prnewswire|businesswire|globenewswire|sentry\.|example\.com/.test(email)) return null;
  const phone = normalizePhone(data.phone);
  const split = splitPersonName(data.firstName, data.lastName);
  const inferred = nameFromEmail(email);
  const firstName = split.firstName || inferred?.firstName || null;
  const lastName = split.lastName || inferred?.lastName || null;
  const title = data.title?.trim() || split.title || null;
  const label = contactLabel(firstName, lastName);

  if (label && isCompanyNameContact(label, companyName) && !email) return null;
  const hasPerson = Boolean(firstName && lastName) && !isCompanyNameContact(label, companyName);
  if (!hasPerson && isGenericEmail(email)) return null;
  if (!email && !hasPerson) return null;

  const existing = await findExistingContact(companyId, { email, firstName, lastName });
  const payload = { firstName: hasPerson ? firstName : existing?.firstName ?? null, lastName: hasPerson ? lastName : existing?.lastName ?? null, title, email, phone, sourceUrl: data.sourceUrl };

  if (existing) {
    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        firstName: existing.firstName || payload.firstName,
        lastName: existing.lastName || payload.lastName,
        title: existing.title || payload.title,
        email: existing.email || payload.email,
        phone: existing.phone || payload.phone,
        sourceUrl: existing.sourceUrl || payload.sourceUrl,
      },
    });
    return updated.id;
  }

  const created = await prisma.contact.create({
    data: { companyId, ...payload },
  });
  return created.id;
}

async function mergeDuplicateContacts(companyId: string, companyName: string): Promise<string | null> {
  let contacts = await prisma.contact.findMany({ where: { companyId } });

  for (const c of contacts) {
    const label = contactLabel(c.firstName, c.lastName);
    if (label && isCompanyNameContact(label, companyName) && !c.email) {
      await prisma.lead.updateMany({ where: { contactId: c.id }, data: { contactId: null } });
      await prisma.contact.delete({ where: { id: c.id } });
    }
  }

  contacts = await prisma.contact.findMany({ where: { companyId } });
  const keepers = new Map<string, string>();

  const keyOf = (c: (typeof contacts)[0]) => {
    if (c.email) return `e:${c.email.toLowerCase()}`;
    const n = normalizeCompanyName(contactLabel(c.firstName, c.lastName));
    if (n) return `n:${n}`;
    return `id:${c.id}`;
  };

  for (const c of contacts) {
    const key = keyOf(c);
    const keeperId = keepers.get(key);
    if (!keeperId) {
      keepers.set(key, c.id);
      continue;
    }
    const keeper = contacts.find((x) => x.id === keeperId);
    if (!keeper) continue;
    await prisma.contact.update({
      where: { id: keeper.id },
      data: {
        firstName: keeper.firstName || c.firstName,
        lastName: keeper.lastName || c.lastName,
        title: keeper.title || c.title,
        email: keeper.email || c.email,
        phone: keeper.phone || c.phone,
        sourceUrl: keeper.sourceUrl || c.sourceUrl,
      },
    });
    await prisma.lead.updateMany({ where: { contactId: c.id }, data: { contactId: keeper.id } });
    await prisma.contact.delete({ where: { id: c.id } });
  }

  const people = await prisma.contact.findMany({ where: { companyId } });
  for (const c of people) {
    if (!c.firstName && !c.lastName && isGenericEmail(c.email)) {
      await prisma.lead.updateMany({ where: { contactId: c.id }, data: { contactId: null } });
      await prisma.contact.delete({ where: { id: c.id } });
    }
  }

  const remaining = await prisma.contact.findMany({ where: { companyId } });
  remaining.sort((a, b) => {
    const aPerson = isPersonName(a.firstName, a.lastName) ? 0 : 1;
    const bPerson = isPersonName(b.firstName, b.lastName) ? 0 : 1;
    if (aPerson !== bPerson) return aPerson - bPerson;
    const aFilled = [a.firstName, a.lastName, a.title, a.email].filter(Boolean).length;
    const bFilled = [b.firstName, b.lastName, b.title, b.email].filter(Boolean).length;
    if (aFilled !== bFilled) return bFilled - aFilled;
    return rankTitle(a.title) - rankTitle(b.title);
  });
  return remaining[0]?.id ?? null;
}

export async function syncProjectFromClassification(params: {
  companyId: string;
  companyName: string;
  projectId?: string | null;
  city?: string | null;
  state?: string | null;
  classified: ClassifyResult;
  extras?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    projectType?: string | null;
    projectStage?: string | null;
    projectValue?: number | null;
    sourceUrl?: string | null;
  };
}): Promise<string | undefined> {
  const stage =
    normalizeProjectStage(params.extras?.projectStage) || normalizeProjectStage(params.classified.project_stage);
  const projectType = params.extras?.projectType || params.classified.project_type;
  const city = params.extras?.city || params.city;
  const address = params.extras?.address || undefined;
  const projectValue = params.extras?.projectValue ?? undefined;
  const betterName = params.extras?.name?.trim();

  if (params.projectId) {
    const existing = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!existing) return undefined;
    await prisma.project.update({
      where: { id: existing.id },
      data: {
        projectType: projectType || existing.projectType,
        projectStage: stage || existing.projectStage,
        address: address || existing.address,
        city: city || existing.city,
        projectValue: projectValue ?? existing.projectValue,
        sourceUrl: params.extras?.sourceUrl || existing.sourceUrl,
        name:
          betterName && (looksLikeNewsHeadline(existing.name) || / construction$/i.test(existing.name))
            ? betterName
            : existing.name,
      },
    });
    return existing.id;
  }
  if (!isActiveConstructionStage(stage)) return undefined;
  const created = await prisma.project.create({
    data: {
      companyId: params.companyId,
      name: betterName || `${params.companyName} construction`,
      address,
      city,
      state: params.state,
      projectType,
      projectStage: stage,
      projectValue,
      sourceUrl: params.extras?.sourceUrl,
    },
  });
  return created.id;
}

const EMPTY_PROFILE: ExtractedContacts = {
  company_name: null,
  website: null,
  company_phone: null,
  city: null,
  state: null,
  company_type: null,
  project_name: null,
  project_type: null,
  project_stage: null,
  project_address: null,
  project_city: null,
  project_value: null,
  contacts: [],
};

export async function persistContactsForCompany(params: {
  companyId: string;
  companyName: string;
  website?: string | null;
  phone?: string | null;
  sourceUrls: string[];
  pageText: string;
  extraPeople?: PersonHit[];
}): Promise<{ contactId: string | null; saved: number; profile: ExtractedContacts }> {
  const company = await prisma.company.findUnique({ where: { id: params.companyId } });
  if (!company) return { contactId: null, saved: 0, profile: EMPTY_PROFILE };

  const regexEmails = emailsInText(params.pageText);
  const regexPhones = phonesInText(params.pageText);
  const extracted = params.pageText
    ? await extractContactsFromText({ companyName: params.companyName, sourceText: params.pageText })
    : EMPTY_PROFILE;

  const heuristicPeople = mergePeople(extracted.contacts, params.extraPeople ?? [], peopleFromText(params.pageText));
  for (const email of regexEmails) {
    if (isGenericEmail(email)) continue;
    if (heuristicPeople.some((c) => (c.email ?? "").toLowerCase() === email)) continue;
    const inferred = nameFromEmail(email);
    heuristicPeople.push({
      email,
      firstName: inferred?.firstName ?? null,
      lastName: inferred?.lastName ?? null,
      title: null,
      phone: null,
    });
  }

  const website = isOfficialWebsite(extracted.website)
    ? extracted.website
    : isOfficialWebsite(params.website)
      ? params.website
      : websiteFromEmail(regexEmails.find((e) => !isGenericEmail(e)) ?? regexEmails[0]);
  const companyPhone = normalizePhone(extracted.company_phone) || regexPhones[0] || params.phone;
  const city = extracted.city || cityFromText(params.pageText) || company.city;
  const betterName = extracted.company_name?.trim();
  const rename =
    Boolean(betterName) &&
    looksLikeNewsHeadline(company.name) &&
    !looksLikeNewsHeadline(betterName!) &&
    betterName!.length > 3;

  await prisma.company.update({
    where: { id: company.id },
    data: {
      ...(rename ? { name: betterName, normalizedName: normalizeCompanyName(betterName!) } : {}),
      website: website || undefined,
      phone: companyPhone || undefined,
      city: city || undefined,
      state: extracted.state || company.state || "FL",
      companyType:
        extracted.company_type && extracted.company_type !== "OTHER" ? extracted.company_type : undefined,
      sourceUrl: params.sourceUrls.find((u) => isOfficialWebsite(u)) || undefined,
    },
  });

  const ids: string[] = [];
  for (const c of heuristicPeople) {
    const id = await upsertContact(params.companyId, betterName || params.companyName, {
      ...c,
      phone: c.phone || companyPhone,
      sourceUrl: params.sourceUrls[0],
    });
    if (id) ids.push(id);
  }

  const contactId = await mergeDuplicateContacts(params.companyId, betterName || params.companyName);

  if (companyPhone) {
    await prisma.contact.updateMany({
      where: { companyId: params.companyId, phone: null, NOT: { firstName: null } },
      data: { phone: companyPhone },
    });
  }

  return {
    contactId,
    saved: [...new Set(ids)].length,
    profile: {
      ...extracted,
      contacts: heuristicPeople,
      city: city ?? null,
      company_phone: companyPhone ?? null,
      website: website ?? null,
    },
  };
}

export async function enrichLead(id: string, location?: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, include });
  if (!lead) return null;

  const intel = await gatherCompanyIntel({
    name: lead.company.name,
    website: lead.company.website,
    city: location?.trim() || lead.company.city,
    extraUrls: [
      websiteFromEmail(lead.contact?.email),
      lead.project?.sourceUrl,
      lead.trigger?.sourceUrl,
      lead.company.sourceUrl,
    ],
  });

  const existingBits = [
    lead.contact ? `Existing contact ${lead.contact.firstName} ${lead.contact.lastName} ${lead.contact.title} ${lead.contact.email} ${lead.contact.phone}` : "",
    lead.company.phone ? `Company phone ${lead.company.phone}` : "",
    lead.company.website ? `Company website ${lead.company.website}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { contactId, saved, profile } = await persistContactsForCompany({
    companyId: lead.companyId,
    companyName: lead.company.name,
    website: intel.website || lead.company.website,
    phone: lead.company.phone,
    sourceUrls: intel.urls,
    pageText: [existingBits, intel.text].filter(Boolean).join("\n\n"),
    extraPeople: intel.people,
  });

  const freshCompany = await prisma.company.findUnique({ where: { id: lead.companyId } });
  const classified = await classifyLead({
    company: freshCompany || lead.company,
    contact: lead.contact,
    project: lead.project,
    trigger: lead.trigger,
    source: lead.source,
    extractedPagePreview: intel.text.slice(0, 4000),
    extractedProfile: {
      company_name: profile.company_name,
      project_name: profile.project_name,
      project_stage: profile.project_stage,
      project_type: profile.project_type,
    },
  });

  const linkedContactId = contactId || lead.contactId;
  const linked = linkedContactId
    ? await prisma.contact.findUnique({ where: { id: linkedContactId } })
    : null;

  const scored = scoreLead({
    hasCompany: true,
    hasPersonContact: isPersonName(linked?.firstName, linked?.lastName),
    hasPhoneOrEmail: Boolean(linked?.phone || linked?.email || freshCompany?.phone || lead.company.phone),
    hasProject: Boolean(lead.project) || isActiveConstructionStage(classified.project_stage),
    hasTrigger: Boolean(lead.trigger),
    companyType: classified.company_type,
    aiScore: classified.exclude ? 0 : classified.score,
  });

  if (freshCompany) {
    await prisma.company.update({
      where: { id: freshCompany.id },
      data: {
        companyType:
          classified.company_type && classified.company_type !== "OTHER"
            ? classified.company_type
            : undefined,
      },
    });
  }
  const projectId = await syncProjectFromClassification({
    companyId: lead.companyId,
    companyName: freshCompany?.name || lead.company.name,
    projectId: lead.projectId,
    city: profile.project_city || freshCompany?.city || lead.company.city,
    state: freshCompany?.state || lead.company.state,
    classified,
    extras: {
      name: profile.project_name,
      address: profile.project_address,
      city: profile.project_city,
      projectType: profile.project_type,
      projectStage: profile.project_stage,
      projectValue: profile.project_value ?? moneyInText(intel.text),
      sourceUrl: intel.urls[0],
    },
  });

  const updated = await prisma.lead.update({
    where: { id },
    data: {
      contactId: linkedContactId,
      projectId,
      score: scored.total,
      recommendedService: classified.recommended_service,
      classified: true,
      status: classified.exclude ? "EXCLUDED" : scored.total >= 60 ? "QUALIFIED" : "RESEARCHED",
    },
    include,
  });

  return { ...updated, contactsSaved: saved };
}

export async function enrichUnclassified(limit = 50, location?: string) {
  const loc = location?.trim();
  const cities = loc ? (/south\s*florida/i.test(loc) ? [loc, ...SOUTH_FL_CITIES] : [loc]) : [];
  const ids = await prisma.lead.findMany({
    where: {
      status: { not: "EXCLUDED" },
      NOT: {
        contact: {
          AND: [{ firstName: { not: null } }, { lastName: { not: null } }],
        },
      },
      ...(cities.length
        ? {
            OR: cities.flatMap((city) => [
              { company: { city: { contains: city, mode: "insensitive" as const } } },
              { project: { city: { contains: city, mode: "insensitive" as const } } },
            ]),
          }
        : {}),
    },
    take: limit,
    select: { id: true },
  });
  let contactsSaved = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of ids) {
    try {
      const out = await enrichLead(row.id, loc);
      contactsSaved += out && "contactsSaved" in out ? Number(out.contactsSaved) : 0;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { processed: ids.length, contactsSaved, failed, errors: errors.slice(0, 5), location: loc || null };
}
