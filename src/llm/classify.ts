import OpenAI from "openai";
import { z } from "zod";
import { env, openRouterKey } from "../config/env";

const OutputSchema = z.object({
  company_type: z.string(),
  recommended_service: z.string(),
  score: z.number().min(0).max(100),
  reason: z.string(),
  project_type: z.string().optional(),
  project_stage: z.string().optional(),
  exclude: z.boolean().default(false),
});

export type ClassifyResult = z.infer<typeof OutputSchema>;

const SYSTEM = `You are a B2B security sales analyst for Fast Guard (unarmed guards, construction site security, fire watch, remote cameras, mobile surveillance, vacant property security).
Return JSON only. Do not invent contact names, emails, or phones.
score is 0-100 lead quality for Fast Guard outbound.
exclude true for security companies, competitors, and residential consumers.
recommended_service must be one Fast Guard service.
company_type: GENERAL_CONTRACTOR, DEVELOPER, PROPERTY_MANAGER, CONSTRUCTION_COMPANY, OTHER.`;

export function llmEnabled(): boolean {
  return Boolean(openRouterKey());
}

function parseJsonContent(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM did not return JSON");
    return JSON.parse(match[0]);
  }
}

export async function openRouterJson(system: string, user: string): Promise<unknown> {
  const apiKey = openRouterKey();
  if (!apiKey) return null;
  const client = new OpenAI({
    apiKey,
    baseURL: env.OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "http://127.0.0.1:8081",
      "X-Title": "Fast Guard Lead Intelligence",
    },
  });
  const models = [
    ...new Set([
      env.OPENROUTER_MODEL,
      "nvidia/nemotron-3.5-lightning:free",
      "z-ai/glm-5.2:free",
      "openrouter/free",
    ]),
  ];
  const messagesJson = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const extra = { provider: { data_collection: "allow" as const, allow_fallbacks: true } };

  for (const model of models) {
    for (const jsonMode of [true, false]) {
      try {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.1,
          messages: jsonMode
            ? messagesJson
            : [
                { role: "system", content: system + "\nRespond with a single JSON object only." },
                { role: "user", content: user },
              ],
          ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
          provider: extra.provider,
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
        const raw = completion.choices[0]?.message?.content ?? "{}";
        return parseJsonContent(raw);
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function classifyLead(payload: unknown): Promise<ClassifyResult> {
  const parsed = await openRouterJson(SYSTEM, JSON.stringify(payload).slice(0, 12000));
  if (!parsed) {
    return {
      company_type: "CONSTRUCTION_COMPANY",
      recommended_service: "Construction Site Security",
      score: 50,
      reason: "LLM unavailable — heuristic placeholder.",
      project_type: "UNKNOWN",
      project_stage: "UNKNOWN",
      exclude: false,
    };
  }
  return OutputSchema.parse(parsed);
}

const ContactExtractSchema = z.object({
  website: z.string().nullable().optional(),
  company_phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  company_type: z.string().nullable().optional(),
  contacts: z
    .array(
      z.object({
        firstName: z.string().nullable().optional(),
        lastName: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export type ExtractedContacts = z.infer<typeof ContactExtractSchema>;

const CONTACT_SYSTEM = `You extract real people and contact details for a South Florida construction or property company.
Return JSON only:
{"website": string|null, "company_phone": string|null, "city": string|null, "company_type": string|null, "contacts":[{"firstName","lastName","title","email","phone"}]}
Rules:
- Never add the company itself (or a news headline) as a contact — only individual people.
- Prefer facts from SOURCE TEXT. Do not invent emails, phones, or people.
- A named person with a job title in the text SHOULD be included even if email/phone is missing.
- Split names: firstName and lastName as separate fields (never put the full name only in firstName).
- Prefer decision makers: Project Superintendent, Project Manager, Property Manager, Director of Operations, Owner, President.
- If an email is present without a name, still include it.
- website must be http(s) if found. company_type one of GENERAL_CONTRACTOR, DEVELOPER, PROPERTY_MANAGER, CONSTRUCTION_COMPANY, OTHER.
- Empty contacts is OK when the text has no people.`;

export async function extractContactsFromText(params: {
  companyName: string;
  sourceText: string;
}): Promise<ExtractedContacts> {
  const parsed = await openRouterJson(
    CONTACT_SYSTEM,
    JSON.stringify({ companyName: params.companyName, sourceText: params.sourceText.slice(0, 12000) }),
  );
  if (!parsed) return { website: null, company_phone: null, city: null, company_type: null, contacts: [] };
  const ok = ContactExtractSchema.safeParse(parsed);
  if (!ok.success) return { website: null, company_phone: null, city: null, company_type: null, contacts: [] };
  return ok.data;
}

const PlaceSchema = z.object({
  project_name: z.string().nullable().optional(),
  project_type: z.string().nullable().optional(),
  project_stage: z.string().nullable().optional(),
  companies: z
    .array(
      z.object({
        name: z.string(),
        relationship: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const PLACE_SYSTEM = `From SOURCE TEXT about a property/construction address, extract JSON only:
{"project_name": string|null, "project_type": string|null, "project_stage": string|null, "companies":[{"name","relationship","website"}]}
relationship examples: general_contractor, owner, developer, property_manager.
Do not invent companies. Only names clearly stated in the text. Website only if present in the text.`;

export async function extractPlaceEntities(params: { address: string; sourceText: string }) {
  const parsed = await openRouterJson(
    PLACE_SYSTEM,
    JSON.stringify({ address: params.address, sourceText: params.sourceText.slice(0, 12000) }),
  );
  if (!parsed) return { project_name: null, project_type: null, project_stage: null, companies: [] };
  return PlaceSchema.parse(parsed);
}
