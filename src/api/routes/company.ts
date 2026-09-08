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
          "Looks up a company in Apollo.io first. If Apollo cannot find a match, falls back to LLM extraction from the headline/description, news, and public pages to save contacts, address, and project info.",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              description: "Stored company id from the dashboard list",
            },
            name: {
              type: "string",
              description: 'Company name or headline, e.g. "ABC Construction"',
            },
            description: {
              type: "string",
              description: "Trigger headline / project description used when the name is not a clean company name",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const q = req.query as { id?: string; name?: string; description?: string };
      const id = q.id?.trim();
      const name = q.name?.trim();
      const description = q.description?.trim();
      if (!id && !name) return reply.code(400).send({ error: "id or name is required" });
      try {
        return await findCompanyByName({ companyId: id, name, description });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code =
          msg === "company not found" ? 404 : /not configured/i.test(msg) ? 400 : /Apollo/i.test(msg) ? 502 : 400;
        return reply.code(code).send({ error: msg });
      }
    },
  );
}
