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
          "Step 4. Merges companies that look like the same firm (normalized name, same website domain, or same phone). Run after import, discover, and enrich.",
      },
    },
    async () => runDuplicateCheck(),
  );
}
