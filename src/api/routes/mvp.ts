import type { FastifyInstance } from "fastify";
import { runDuplicateCheck } from "../../services/dedupe";
import { truncateAllTables } from "../../services/truncate";

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

  app.post(
    "/reset",
    {
      schema: {
        tags: ["Admin"],
        summary: "Truncate all tables",
        description:
          "Deletes every company, contact, project, trigger, lead, and source row. Use this to start a demo from a clean database, then run Discover again.",
      },
    },
    async () => truncateAllTables(),
  );
}
