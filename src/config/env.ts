import "dotenv/config";
import { z } from "zod";

function applyHostedPostgresEnv() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_DATABASE_URL ||
      process.env.PRISMA_DATABASE_URL ||
      "";
  }
  if (!process.env.DIRECT_URL) {
    process.env.DIRECT_URL =
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.DATABASE_URL ||
      "";
  }
}
applyHostedPostgresEnv();

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8081),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  LLM_API_KEY: z.string().optional().default(""),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("nvidia/nemotron-3.5-lightning:free"),
  CRAWLER_USER_AGENT: z.string().default("FastGuardLeadEngine/1.0"),
});

export const env = EnvSchema.parse(process.env);

export function openRouterKey(): string {
  return env.OPENROUTER_API_KEY || env.LLM_API_KEY;
}

export const QUALIFIED_SCORE = 60;

export function prismaRuntimeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol.startsWith("prisma")) return raw;
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (!local) {
      if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
      if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "1");
      if (u.hostname.includes("pooler") || u.searchParams.get("pgbouncer") === "true") {
        u.searchParams.set("pgbouncer", "true");
      }
    }
    return u.toString();
  } catch {
    return raw;
  }
}
