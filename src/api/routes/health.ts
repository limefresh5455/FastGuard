import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client";

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Health check",
        description:
          "Confirms the API process is running and PostgreSQL accepts a query. Use this first if Swagger “Failed to fetch” or the database looks down. Does not return leads.",
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean", description: "true when the database ping succeeded" },
              service: { type: "string" },
              phase: { type: "number" },
            },
          },
        },
      },
    },
    async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, service: "fastguard-mvp", phase: 1 };
    },
  );
}
