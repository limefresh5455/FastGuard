import type { FastifyInstance } from "fastify";
import { discoverByLocation } from "../../services/discover";

export async function discoverRoutes(app: FastifyInstance) {
  app.post(
    "/",
    {
      schema: {
        tags: ["Discover"],
        summary: "Find companies, projects, and triggers by location",
        description:
          'Step 2. Body has only **location** (a region like `"South Florida"`). Scans public construction and property news for that area.',
        body: {
          type: "object",
          additionalProperties: false,
          required: ["location"],
          properties: {
            location: {
              type: "string",
              description: 'Region to scan, e.g. "South Florida"',
              examples: ["South Florida"],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const location = (req.body as { location?: string }).location?.trim();
      if (!location) return reply.code(400).send({ error: "location is required" });
      return discoverByLocation(location);
    },
  );
}
