import type { FastifyInstance } from "fastify";
import { findCompanyByName } from "../../services/lookup";

export async function companyRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Company"],
        summary: "Find company domain and contacts by name (Apollo)",
        description:
          "Looks up **one company** in Apollo.io by name, saves the domain/website, phone, and people (name, title, email, phone) into Company/Contact, and returns the stored card for the demo UI. Does not run enrich-all.",
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
        const code =
          msg === "company not found" ? 404 : /not configured/i.test(msg) ? 400 : /Apollo/i.test(msg) ? 502 : 400;
        return reply.code(code).send({ error: msg });
      }
    },
  );
}
