import { prisma } from "../db/client";
import { classifyLead, extractContactsFromText } from "../llm/classify";
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

function splitPersonName(first?: string | null, last?: string | null): { firstName: string | null; lastName: string | null } {
  let firstName = first?.trim() || null;
  let lastName = last?.trim() || null;
  if (firstName && !lastName) {
    const parts = firstName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(" ");
    }
  }
  return { firstName, lastName };
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
  const { firstName, lastName } = splitPersonName(data.firstName, data.lastName);
  const title = data.title?.trim() || null;
  const label = contactLabel(firstName, lastName);

  if (label && isCompanyNameContact(label, companyName)) {
    if (!email) return null;
  }
  const hasPerson = Boolean(firstName && lastName) && !isCompanyNameContact(label, companyName);
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
  people.sort((a, b) => {
    const aPerson = isPersonName(a.firstName, a.lastName) ? 0 : 1;
    const bPerson = isPersonName(b.firstName, b.lastName) ? 0 : 1;
    if (aPerson !== bPerson) return aPerson - bPerson;
    return rankTitle(a.title) - rankTitle(b.title);
  });
  return people[0]?.id ?? null;
}

export async function persistContactsForCompany(params: {
  companyId: string;
  companyName: string;
  website?: string | null;
  phone?: string | null;
  sourceUrls: string[];
  pageText: string;
}): Promise<{ contactId: string | null; saved: number }> {
  const regexEmails = emailsInText(params.pageText);
  const regexPhones = phonesInText(params.pageText);
  const extracted = params.pageText
    ? await extractContactsFromText({ companyName: params.companyName, sourceText: params.pageText })
    : { website: null, company_phone: null, city: null, company_type: null, contacts: [] };

  const website = isOfficialWebsite(extracted.website)
    ? extracted.website
    : isOfficialWebsite(params.website)
      ? params.website
      : websiteFromEmail(regexEmails[0]);
  const companyPhone = normalizePhone(extracted.company_phone) || regexPhones[0] || params.phone;

  await prisma.company.update({
    where: { id: params.companyId },
    data: {
      website: website || undefined,
      phone: companyPhone || undefined,
      city: extracted.city || undefined,
      companyType: extracted.company_type || undefined,
      sourceUrl: params.sourceUrls.find((u) => isOfficialWebsite(u)) || undefined,
    },
  });

  const merged = [...extracted.contacts];
  for (const email of regexEmails) {
    if (!merged.some((c) => (c.email ?? "").toLowerCase() === email)) {
      merged.push({ email, firstName: null, lastName: null, title: null, phone: null });
    }
  }

  const ids: string[] = [];
  for (const c of merged) {
    const id = await upsertContact(params.companyId, params.companyName, {
      ...c,
      phone: c.phone || companyPhone,
      sourceUrl: params.sourceUrls[0],
    });
    if (id) ids.push(id);
  }

  const contactId = await mergeDuplicateContacts(params.companyId, params.companyName);

  if (companyPhone) {
    await prisma.contact.updateMany({
      where: { companyId: params.companyId, phone: null },
      data: { phone: companyPhone },
    });
  }

  return { contactId, saved: [...new Set(ids)].length };
}

export async function enrichLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, include });
  if (!lead) return null;

  const intel = await gatherCompanyIntel({
    name: lead.company.name,
    website: lead.company.website,
    city: lead.company.city,
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

  const { contactId, saved } = await persistContactsForCompany({
    companyId: lead.companyId,
    companyName: lead.company.name,
    website: intel.website || lead.company.website,
    phone: lead.company.phone,
    sourceUrls: intel.urls,
    pageText: [existingBits, intel.text].filter(Boolean).join("\n\n"),
  });

  const classified = await classifyLead({
    company: lead.company,
    contact: lead.contact,
    project: lead.project,
    trigger: lead.trigger,
    source: lead.source,
    extractedPagePreview: intel.text.slice(0, 2000),
  });

  const linkedContactId = contactId || lead.contactId;
  const linked = linkedContactId
    ? await prisma.contact.findUnique({ where: { id: linkedContactId } })
    : null;

  const scored = scoreLead({
    hasCompany: true,
    hasPersonContact: isPersonName(linked?.firstName, linked?.lastName),
    hasPhoneOrEmail: Boolean(linked?.phone || linked?.email || lead.company.phone),
    hasProject: Boolean(lead.project),
    hasTrigger: Boolean(lead.trigger),
    companyType: classified.company_type,
    aiScore: classified.exclude ? 0 : classified.score,
  });

  await prisma.company.update({
    where: { id: lead.companyId },
    data: { companyType: classified.company_type },
  });
  if (lead.projectId) {
    await prisma.project.update({
      where: { id: lead.projectId },
      data: {
        projectType: classified.project_type,
        projectStage: classified.project_stage,
      },
    });
  }

  const updated = await prisma.lead.update({
    where: { id },
    data: {
      contactId: linkedContactId,
      score: scored.total,
      recommendedService: classified.recommended_service,
      classified: true,
      status: classified.exclude ? "EXCLUDED" : scored.total >= 60 ? "QUALIFIED" : "RESEARCHED",
    },
    include,
  });

  return { ...updated, contactsSaved: saved };
}

export async function enrichUnclassified(limit = 50) {
  const ids = await prisma.lead.findMany({
    where: {
      status: { not: "EXCLUDED" },
      NOT: {
        contact: {
          AND: [{ email: { not: null } }, { firstName: { not: null } }, { lastName: { not: null } }],
        },
      },
    },
    take: limit,
    select: { id: true },
  });
  let contactsSaved = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of ids) {
    try {
      const out = await enrichLead(row.id);
      contactsSaved += out && "contactsSaved" in out ? Number(out.contactsSaved) : 0;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { processed: ids.length, contactsSaved, failed, errors: errors.slice(0, 5) };
}
