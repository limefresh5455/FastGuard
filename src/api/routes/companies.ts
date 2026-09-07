import type { FastifyInstance } from "fastify";
import { getCompanyById, listCompanies } from "../../services/companies";

export async function companiesRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Company"],
        summary: "List company names and all stored data",
        description:
          "Returns every company (name, type, city, website, phone) plus nested contacts, projects, triggers, and leads. Optional `q` filters by name, city, or type. Does not re-enrich.",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", description: "Search company name, city, or type" },
          },
        },
      },
    },
    async (req) => {
      const q = (req.query as { q?: string }).q;
      return listCompanies(q);
    },
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["Company"],
        summary: "One company with contacts, projects, triggers, leads",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const company = await getCompanyById(id);
      if (!company) return reply.code(404).send({ error: "company not found" });
      return company;
    },
  );
}
