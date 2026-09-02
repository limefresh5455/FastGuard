import OpenAI from "openai";
import { z } from "zod";
import { env, openRouterKey } from "../config/env";
import { isActiveConstructionStage, resolveConstructionStage } from "../lib/constructionFit";
import { mergePeople, normalizeLooseContact, type PersonHit } from "../lib/extract";

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
  company_name: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  company_phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  company_type: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  project_type: z.string().nullable().optional(),
  project_stage: z.string().nullable().optional(),
  project_address: z.string().nullable().optional(),
  project_city: z.string().nullable().optional(),
  project_value: z.coerce.number().nullable().optional(),
  contacts: z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") return Object.values(v as Record<string, unknown>);
    return [];
  }, z.array(z.unknown()).default([])),
});

export type ExtractedContacts = {
  company_name: string | null;
  website: string | null;
  company_phone: string | null;
  city: string | null;
  state: string | null;
  company_type: string | null;
  project_name: string | null;
  project_type: string | null;
  project_stage: string | null;
  project_address: string | null;
  project_city: string | null;
  project_value: number | null;
  contacts: PersonHit[];
};

const emptyProfile = (): ExtractedContacts => ({
  company_name: null,
  website: null,
  company_phone: null,
  city: null,
  state: null,
  company_type: null,
  project_name: null,
  project_type: null,
  project_stage: null,
  project_address: null,
  project_city: null,
  project_value: null,
  contacts: [],
});

const CONTACT_SYSTEM = `You extract real people and company/project facts for a South Florida construction firm.
Return JSON only with this shape:
{"company_name": string|null, "website": string|null, "company_phone": string|null, "city": string|null, "state": string|null, "company_type": string|null, "project_name": string|null, "project_type": string|null, "project_stage": string|null, "project_address": string|null, "project_city": string|null, "project_value": number|null, "contacts":[{"firstName","lastName","title","email","phone"}]}

Rules:
- contacts must be individual people (never the company, a newspaper, or a headline).
- ALWAYS split the person's name: firstName and lastName as separate fields. Also fill title when stated.
- A named person with a job title SHOULD be included even if email/phone is missing.
- News quotes count: "said Maria Lopez, project manager" is a contact.
- Prefer decision makers: Project Superintendent, Project Manager, Director of Operations, Owner, President, VP, Principal.
- Do not invent emails, phones, or people. Empty contacts is OK when the text has no people.
- Do not add info@, sales@, office@, contact@ as contacts unless you also have a real first and last name.
- company_name should be the legal/trade name of the contractor, developer, or owner — not a news headline.
- project_stage: UNDERWAY, STARTING_SOON, COMPLETED, or NONE.
- company_type: GENERAL_CONTRACTOR, DEVELOPER, PROPERTY_MANAGER, CONSTRUCTION_COMPANY, OTHER.
- website must be http(s) if found.`;

function toProfile(parsed: unknown, sourceText: string): ExtractedContacts {
  const ok = ContactExtractSchema.safeParse(parsed);
  const base = emptyProfile();
  if (!ok.success) {
    return { ...base, contacts: mergePeople([], []) };
  }
  const d = ok.data;
  const contacts = mergePeople(d.contacts.map(normalizeLooseContact).filter(Boolean) as PersonHit[]);
  return {
    company_name: d.company_name ?? null,
    website: d.website ?? null,
    company_phone: d.company_phone ?? null,
    city: d.city ?? null,
    state: d.state ?? null,
    company_type: d.company_type ?? null,
    project_name: d.project_name ?? null,
    project_type: d.project_type ?? null,
    project_stage: resolveConstructionStage(d.project_stage, sourceText),
    project_address: d.project_address ?? null,
    project_city: d.project_city ?? null,
    project_value: d.project_value ?? null,
    contacts,
  };
}

export async function extractContactsFromText(params: {
  companyName: string;
  sourceText: string;
}): Promise<ExtractedContacts> {
  const parsed = await openRouterJson(
    CONTACT_SYSTEM,
    JSON.stringify({ companyName: params.companyName, sourceText: params.sourceText.slice(0, 12000) }),
  );
  if (!parsed) return emptyProfile();
  return toProfile(parsed, params.sourceText);
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
