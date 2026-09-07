import type { FastifyInstance } from "fastify";
import { runDuplicateCheck } from "../../services/dedupe";

export async function mvpRoutes(app: FastifyInstance) {
  app.post(
    "/dedupe",
    {
      schema: {
        tags: ["Dedupe"],
        summary: "Duplicate check",
        description:
          "Merges companies that look like the same firm (normalized name, same website domain, or same phone). Run after discover and enrich.",
      },
    },
    async () => runDuplicateCheck(),
  );
}
