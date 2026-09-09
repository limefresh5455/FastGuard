import type { FastifyInstance } from "fastify";
import { discoverByLocation, discoverByPrompt } from "../../services/discover";

export async function discoverRoutes(app: FastifyInstance) {
  app.post(
    "/",
    {
      schema: {
        tags: ["Discover"],
        summary: "Find companies, projects, and triggers by location",
        description:
          'Step 2. Body has only **location** (a region like `"South Florida"`). Scans public construction and property news for that area. Response includes **names** (company names) and **companies** (id, name, project, score).',
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

  app.post(
    "/prompt",
    {
      schema: {
        tags: ["Discover"],
        summary: "Find companies, projects, and triggers by custom prompt + location",
        description:
          'Body has **location** and **prompt**. Scans public news for that area using your custom search prompt(s). Same response shape as location-only discover.',
        body: {
          type: "object",
          additionalProperties: false,
          required: ["location", "prompt"],
          properties: {
            location: {
              type: "string",
              description: 'Region to scan, e.g. "South Florida"',
              examples: ["South Florida"],
            },
            prompt: {
              type: "string",
              description: 'Custom search prompt, e.g. "hotel renovation projects"',
              examples: ["multifamily tower construction"],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { location?: string; prompt?: string };
      const location = body.location?.trim();
      const prompt = body.prompt?.trim();
      if (!location) return reply.code(400).send({ error: "location is required" });
      if (!prompt) return reply.code(400).send({ error: "prompt is required" });
      return discoverByPrompt(location, prompt);
    },
  );
}
