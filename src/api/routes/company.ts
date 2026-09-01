import type { FastifyInstance } from "fastify";
import { findCompanyByName } from "../../services/lookup";

export async function companyRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Company"],
        summary: "Find company, contacts, and details by name",
        description:
          "Finds the company by **name**, uses the LLM on public pages/news, and **saves contacts** (name, title, email, phone) into the Contact table. Also updates company website/phone when found.",
        querystring: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: {
              type: "string",
              description: 'Company name, e.g. "ABC Construction"',
            },
          },
        },
      },
    },
    async (req, reply) => {
      const name = (req.query as { name?: string }).name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });
      try {
        return await findCompanyByName(name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = msg === "company not found" ? 404 : 400;
        return reply.code(code).send({ error: msg });
      }
    },
  );
}
