import type { FastifyInstance } from "fastify";
import { enrichUnclassified } from "../../services/enrich";

export async function leadRoutes(app: FastifyInstance) {
  app.post(
    "/enrich-all",
    {
      schema: {
        tags: ["Leads"],
        summary: "Enrich contacts, AI classify, score 0–100",
        description: [
          "Step 3 of the MVP. Processes up to `limit` leads that are not classified or have no contact.",
          "Fetches company websites and news, extracts people with the LLM, and **upserts** Contact rows (no duplicate company-name contacts).",
          "Requires OPENROUTER_API_KEY. Does not invent emails or names.",
        ].join("\n"),
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: {
              type: "integer",
              description: "How many leads to process (default 50)",
              default: 50,
            },
          },
        },
      },
    },
    async (req) => {
      const q = (req.body as { limit?: number }) ?? {};
      return enrichUnclassified(q.limit ?? 50);
    },
  );
}
