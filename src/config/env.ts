import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8081),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
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
