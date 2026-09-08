import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "../config/env";
import { resolvePublicFile } from "../lib/paths";
import { healthRoutes } from "./routes/health";
import { leadRoutes } from "./routes/leads";
import { discoverRoutes } from "./routes/discover";
import { dashboardRoutes } from "./routes/dashboard";
import { companiesRoutes } from "./routes/companies";
import { companyRoutes } from "./routes/company";
import { mvpRoutes } from "./routes/mvp";

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
    disableRequestLogging: Boolean(process.env.VERCEL),
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return reply.code(500).send({ error: "Internal Server Error", message });
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Fast Guard Sales Intelligence — Phase 1 MVP",
        version: "1.0.0",
        description: [
          "South Florida only. Discover companies/projects → enrich + AI score 0–100 → duplicate check → dashboard.",
          "Open `/` for the demo UI. API docs: /docs.",
          "Not in MVP: national scrape, CRM, RFP engine, feedback learning.",
        ].join("\n"),
      },
      tags: [
        { name: "Health", description: "API + database" },
        { name: "Discover", description: "1. Companies, projects, triggers by location" },
        { name: "Leads", description: "2. Enrich contacts + classify + score" },
        { name: "Dedupe", description: "3. Duplicate check" },
        { name: "Dashboard", description: "4. Companies, all leads, qualified leads" },
        { name: "Company", description: "List companies or find contacts by name" },
        { name: "Admin", description: "Reset / truncate demo data" },
      ],
      servers: [{ url: "/", description: "This host" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  const sendDemo = async (_req: unknown, reply: { type: (t: string) => { send: (b: string) => unknown } }) => {
    const html = await readFile(resolvePublicFile("index.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  };
  const sendPublic = async (
    name: string,
    type: string,
    reply: { type: (t: string) => { header: (k: string, v: string) => { send: (b: Buffer) => unknown } } },
  ) => {
    const buf = await readFile(resolvePublicFile(name));
    return reply.type(type).header("cache-control", "public, max-age=86400").send(buf);
  };
  const hidden = { schema: { hide: true as const } };
  app.get("/", hidden, sendDemo);
  app.get("/app", hidden, sendDemo);
  app.get("/favicon.svg", hidden, async (_req, reply) => sendPublic("favicon.svg", "image/svg+xml", reply));
  app.get("/favicon.png", hidden, async (_req, reply) => sendPublic("favicon.png", "image/png", reply));
  app.get("/favicon.ico", hidden, async (_req, reply) => sendPublic("favicon.png", "image/png", reply));
  app.get("/apple-touch-icon.png", hidden, async (_req, reply) => sendPublic("apple-touch-icon.png", "image/png", reply));
  await app.register(healthRoutes);
  await app.register(mvpRoutes, { prefix: "/api" });
  await app.register(leadRoutes, { prefix: "/api/leads" });
  await app.register(discoverRoutes, { prefix: "/api/discover" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(companiesRoutes, { prefix: "/api/companies" });
  await app.register(companyRoutes, { prefix: "/api/company" });
  return app;
}
