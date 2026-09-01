import type { Prisma } from "@prisma/client";

export const leadCardInclude = {
  company: true,
  contact: true,
  project: true,
  trigger: true,
} satisfies Prisma.LeadInclude;

export function toDashboardRow(lead: {
  id: string;
  score: number;
  recommendedService: string | null;
  source: string;
  status: string;
  classified: boolean;
  company: { name: string; companyType: string; city: string | null; state: string | null; phone: string | null; website: string | null };
  contact: { firstName: string | null; lastName: string | null; title: string | null; email: string | null; phone: string | null } | null;
  project: { name: string; address: string | null; city: string | null; state: string | null; projectType: string | null; projectStage: string | null } | null;
  trigger: { triggerType: string; headline: string; triggerDate: Date; sourceUrl: string } | null;
}) {
  return {
    id: lead.id,
    score: lead.score,
    recommendedService: lead.recommendedService,
    source: lead.source,
    status: lead.status,
    classified: lead.classified,
    company: lead.company.name,
    companyType: lead.company.companyType,
    city: lead.company.city,
    state: lead.company.state,
    contact: lead.contact
      ? {
          name: [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(" "),
          title: lead.contact.title,
          email: lead.contact.email,
          phone: lead.contact.phone,
        }
      : null,
    project: lead.project
      ? {
          name: lead.project.name,
          address: [lead.project.address, lead.project.city, lead.project.state].filter(Boolean).join(", "),
          type: lead.project.projectType,
          stage: lead.project.projectStage,
        }
      : null,
    trigger: lead.trigger
      ? {
          type: lead.trigger.triggerType,
          headline: lead.trigger.headline,
          date: lead.trigger.triggerDate,
          sourceUrl: lead.trigger.sourceUrl,
        }
      : null,
  };
}
