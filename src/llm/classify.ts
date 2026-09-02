import OpenAI from "openai";
import { z } from "zod";
import { env, openRouterKey } from "../config/env";
import { isActiveConstructionStage, resolveConstructionStage } from "../lib/constructionFit";

const OutputSchema = z.object({
  company_type: z.string().catch("OTHER"),
  recommended_service: z.string().catch("General Security"),
  score: z.coerce.number().min(0).max(100).catch(50),
  reason: z.string().optional().default("No reason provided."),
  project_type: z.string().optional(),
  project_stage: z.string().optional(),
  exclude: z.coerce.boolean().default(false).catch(false),
});

export type ClassifyResult = z.infer<typeof OutputSchema>;

const SYSTEM = `You are a B2B security sales analyst for Fast Guard (unarmed guards, construction site security, fire watch, remote cameras, mobile surveillance).
Return JSON only. Do not invent contact names, emails, or phones.

Fast Guard only wants companies that need construction security RIGHT NOW:
- KEEP if they have a construction project CURRENTLY UNDERWAY (site work, vertical construction, active jobsite).
- KEEP if they have a construction project STARTING SOON (groundbreaking, permits issued, construction to begin within ~6 months).
- EXCLUDE property managers, landlords, and operating buildings with no active or upcoming construction.
- EXCLUDE completed / opened / delivered projects. Nearing completion still counts as UNDERWAY.

JSON fields:
- score 0-100: 90+ active jobsites, 70-89 starting soon, 20 or less if finished or no project.
- exclude: true unless project_stage is UNDERWAY or STARTING_SOON.
- reason: 1-2 sentences on project status (what is being built, and whether it is underway or starting soon).
- project_stage: exactly one of UNDERWAY, STARTING_SOON, COMPLETED, NONE.
- recommended_service: Construction Site Security when kept; otherwise General Security.
- company_type: GENERAL_CONTRACTOR, DEVELOPER, PROPERTY_MANAGER, CONSTRUCTION_COMPANY, OTHER.`;

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

function applyConstructionGate(result: ClassifyResult, sourceText: string): ClassifyResult {
  const stage = resolveConstructionStage(result.project_stage, sourceText);
  const keep = isActiveConstructionStage(stage);
  return {
    ...result,
    project_stage: stage,
    exclude: !keep,
    score: keep ? result.score : Math.min(result.score, 20),
    recommended_service: keep ? result.recommended_service || "Construction Site Security" : result.recommended_service,
    reason: keep
      ? result.reason
      : result.reason || "No construction project currently underway or starting soon.",
  };
}

export async function classifyLead(payload: unknown): Promise<ClassifyResult> {
  const blob = JSON.stringify(payload ?? {});
  const parsed = await openRouterJson(SYSTEM, blob.slice(0, 12000));
  if (!parsed) {
    const stage = resolveConstructionStage(undefined, blob);
    const keep = isActiveConstructionStage(stage);
    return {
      company_type: "CONSTRUCTION_COMPANY",
      recommended_service: keep ? "Construction Site Security" : "General Security",
      score: keep ? 70 : 20,
      reason: keep
        ? `Heuristic: construction looks ${stage}.`
        : "No construction project currently underway or starting soon.",
      project_type: "UNKNOWN",
      project_stage: stage,
      exclude: !keep,
    };
  }
  return applyConstructionGate(OutputSchema.parse(parsed), blob);
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
project_stage must be UNDERWAY, STARTING_SOON, COMPLETED, or NONE.
- UNDERWAY: active jobsite / under construction
- STARTING_SOON: groundbreaking, permits, construction to begin within ~6 months
- COMPLETED: opened, delivered, construction finished
- NONE: no construction project
Prefer general contractors, developers, and owners of UNDERWAY or STARTING_SOON work.
Do not invent companies. Only names clearly stated in the text. Website only if present in the text.`;

export async function extractPlaceEntities(params: { address: string; sourceText: string }) {
  const parsed = await openRouterJson(
    PLACE_SYSTEM,
    JSON.stringify({ address: params.address, sourceText: params.sourceText.slice(0, 12000) }),
  );
  if (!parsed) return { project_name: null, project_type: null, project_stage: "NONE", companies: [] };
  const place = PlaceSchema.parse(parsed);
  return {
    ...place,
    project_stage: resolveConstructionStage(place.project_stage, params.sourceText),
  };
}
