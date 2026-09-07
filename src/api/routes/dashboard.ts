import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client";
import { QUALIFIED_SCORE } from "../../config/env";
import { ACTIVE_PROJECT_STAGES } from "../../lib/constructionFit";
import { listCompanies } from "../../services/companies";
import { leadCardInclude, toDashboardRow } from "../../services/dashboard";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Dashboard"],
        summary: "Sales dashboard — companies, all leads, qualified leads",
        description:
          "Demo view of stored data: company names, contacts, projects, triggers, every lead, plus qualified leads (score ≥ 60 with an active project).",
      },
    },
    async () => {
      const [qualified, allLeads, companies, all, imported, discovered, classified, contacts, projects, triggers] =
        await Promise.all([
          prisma.lead.findMany({
            where: {
              score: { gte: QUALIFIED_SCORE },
              status: { not: "EXCLUDED" },
              project: { projectStage: { in: [...ACTIVE_PROJECT_STAGES] } },
            },
            orderBy: { score: "desc" },
            take: 100,
            include: leadCardInclude,
          }),
          prisma.lead.findMany({
            orderBy: { score: "desc" },
            take: 500,
            include: leadCardInclude,
          }),
          listCompanies(),
          prisma.lead.count(),
          prisma.lead.count({ where: { status: "IMPORTED" } }),
          prisma.lead.count({ where: { status: "DISCOVERED" } }),
          prisma.lead.count({ where: { classified: true } }),
          prisma.contact.count(),
          prisma.project.count(),
          prisma.triggerEvent.count(),
        ]);
      return {
        location: "South Florida",
        totals: {
          all,
          imported,
          discovered,
          classified,
          qualified: qualified.length,
          companies: companies.count,
          contacts,
          projects,
          triggers,
        },
        names: companies.names,
        companies: companies.companies,
        qualifiedLeads: qualified.map(toDashboardRow),
        allLeads: allLeads.map(toDashboardRow),
      };
    },
  );
}
