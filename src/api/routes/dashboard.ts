import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client";
import { QUALIFIED_SCORE } from "../../config/env";
import { leadCardInclude, toDashboardRow } from "../../services/dashboard";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Dashboard"],
        summary: "Sales dashboard — qualified leads and counts",
        description:
          "Step 5. Qualified leads (score ≥ 60): Company, Contact, Project, Trigger, Recommended Service, Score, Source.",
      },
    },
    async () => {
      const [qualified, all, imported, discovered, classified] = await Promise.all([
        prisma.lead.findMany({
          where: { score: { gte: QUALIFIED_SCORE }, status: { not: "EXCLUDED" } },
          orderBy: { score: "desc" },
          take: 100,
          include: leadCardInclude,
        }),
        prisma.lead.count(),
        prisma.lead.count({ where: { status: "IMPORTED" } }),
        prisma.lead.count({ where: { status: "DISCOVERED" } }),
        prisma.lead.count({ where: { classified: true } }),
      ]);
      return {
        location: "South Florida",
        totals: { all, imported, discovered, classified, qualified: qualified.length },
        qualifiedLeads: qualified.map(toDashboardRow),
      };
    },
  );
}
