import { prisma } from "../db/client";

const companyInclude = {
  contacts: { orderBy: { createdAt: "desc" as const } },
  projects: { orderBy: { createdAt: "desc" as const } },
  triggers: { orderBy: { triggerDate: "desc" as const } },
  leads: { orderBy: { score: "desc" as const } },
};

function contactName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ") || null;
}

export function toCompanyCard(company: {
  id: string;
  name: string;
  companyType: string;
  website: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  contacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    sourceUrl: string | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    projectType: string | null;
    projectStage: string | null;
    projectValue: number | null;
    sourceUrl: string | null;
  }>;
  triggers: Array<{
    id: string;
    triggerType: string;
    triggerDate: Date;
    headline: string;
    sourceUrl: string;
  }>;
  leads: Array<{
    id: string;
    score: number;
    recommendedService: string | null;
    source: string;
    status: string;
    classified: boolean;
    contactId: string | null;
    projectId: string | null;
  }>;
}) {
  return {
    id: company.id,
    name: company.name,
    companyType: company.companyType,
    website: company.website,
    phone: company.phone,
    city: company.city,
    state: company.state,
    sourceUrl: company.sourceUrl,
    createdAt: company.createdAt,
    contacts: company.contacts.map((c) => ({
      id: c.id,
      name: contactName(c.firstName, c.lastName),
      title: c.title,
      email: c.email,
      phone: c.phone,
      sourceUrl: c.sourceUrl,
    })),
    projects: company.projects.map((p) => ({
      id: p.id,
      name: p.name,
      address: [p.address, p.city, p.state].filter(Boolean).join(", ") || null,
      type: p.projectType,
      stage: p.projectStage,
      value: p.projectValue,
      sourceUrl: p.sourceUrl,
    })),
    triggers: company.triggers.map((t) => ({
      id: t.id,
      type: t.triggerType,
      headline: t.headline,
      date: t.triggerDate,
      sourceUrl: t.sourceUrl,
    })),
    leads: company.leads.map((l) => ({
      id: l.id,
      score: l.score,
      recommendedService: l.recommendedService,
      source: l.source,
      status: l.status,
      classified: l.classified,
    })),
  };
}

export async function listCompanies(q?: string) {
  const query = q?.trim();
  const companies = await prisma.company.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { normalizedName: { contains: query.toLowerCase(), mode: "insensitive" } },
            { city: { contains: query, mode: "insensitive" } },
            { companyType: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    take: 500,
    include: companyInclude,
  });
  const cards = companies.map(toCompanyCard);
  return {
    count: cards.length,
    names: cards.map((c) => c.name),
    companies: cards,
  };
}

export async function getCompanyById(id: string) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: companyInclude,
  });
  return company ? toCompanyCard(company) : null;
}
