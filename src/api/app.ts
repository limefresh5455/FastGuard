import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "../config/env";
import { healthRoutes } from "./routes/health";
import { importRoutes } from "./routes/import";
import { leadRoutes } from "./routes/leads";
import { discoverRoutes } from "./routes/discover";
import { dashboardRoutes } from "./routes/dashboard";
import { companyRoutes } from "./routes/company";
import { mvpRoutes } from "./routes/mvp";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Fast Guard Sales Intelligence — Phase 1 MVP",
        version: "1.0.0",
        description: [
          "South Florida only. Excel import → discover companies/projects → enrich + AI score 0–100 → duplicate check → dashboard.",
          "Not in MVP: national scrape, CRM, RFP engine, feedback learning.",
          "Use **http://127.0.0.1:8081**. Excel = multipart `file`, not JSON.",
        ].join("\n"),
      },
      tags: [
        { name: "Health", description: "API + database" },
        { name: "Import", description: "1. Excel leads" },
        { name: "Discover", description: "2. Companies, projects, triggers by location" },
        { name: "Leads", description: "3. Enrich contacts + classify + score" },
        { name: "Dedupe", description: "4. Duplicate check" },
        { name: "Dashboard", description: "5. Qualified leads" },
        { name: "Company", description: "Find contacts and details by company name" },
      ],
      servers: [{ url: `http://127.0.0.1:${env.PORT}`, description: "Local API" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.get("/", async (_req, reply) => reply.redirect("/docs"));
  await app.register(healthRoutes);
  await app.register(mvpRoutes, { prefix: "/api" });
  await app.register(importRoutes, { prefix: "/api/import" });
  await app.register(leadRoutes, { prefix: "/api/leads" });
  await app.register(discoverRoutes, { prefix: "/api/discover" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(companyRoutes, { prefix: "/api/company" });
  return app;
}
