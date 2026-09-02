export const ACTIVE_PROJECT_STAGES = ["UNDERWAY", "STARTING_SOON"] as const;
export type ProjectStage = (typeof ACTIVE_PROJECT_STAGES)[number] | "COMPLETED" | "NONE";

const COMPLETED_RE =
  /\b(grand opening|ribbon[- ]cut(?:ting)?|now open|officially open(?:ed)?|construction (?:is |has been )?complete(?:d)?|completed construction|project complete(?:d)?|fully complete|certificate of occupancy|\bc of o\b|sold out|fully leased|construction wrapped|delivered to (?:residents|tenants))\b/i;

const UNDERWAY_RE =
  /\b(under construction|construction underway|currently underway|work is underway|site work|vertical construction|topping out|building rising|construction continues|nearing completion|active construction|construction progressing|crane on (?:the )?site|concrete pour)\b/i;

const STARTING_SOON_RE =
  /\b(breaks? ground|groundbreaking|will break ground|set to break ground|construction to begin|set to begin construction|construction (?:will |to )?start|building permit (?:issued|approved)|permit issued|expected to start|site work (?:to |will )?begin|pre-?construction|slated (?:to|for) construction)\b/i;

export function normalizeProjectStage(raw?: string | null): ProjectStage | undefined {
  if (!raw) return undefined;
  const t = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (t === "UNKNOWN" || t === "N_A" || t === "NA") return "NONE";
  if (t.includes("UNDERWAY") || t.includes("UNDER_CONSTRUCTION") || t === "IN_PROGRESS" || t === "ONGOING" || t.includes("NEARING_COMPLETION")) {
    return "UNDERWAY";
  }
  if (
    t.includes("STARTING_SOON") ||
    t.includes("UPCOMING") ||
    t === "PLANNED" ||
    t.includes("PRECONSTRUCTION") ||
    t.includes("BREAKING_GROUND")
  ) {
    return "STARTING_SOON";
  }
  if (t.includes("COMPLETE") || t.includes("FINISHED") || t.includes("DELIVERED") || t === "OPENED") return "COMPLETED";
  if (t === "NONE") return "NONE";
  return undefined;
}

export function inferProjectStage(text: string): ProjectStage {
  const t = text || "";
  if (COMPLETED_RE.test(t) && !UNDERWAY_RE.test(t)) return "COMPLETED";
  if (UNDERWAY_RE.test(t)) return "UNDERWAY";
  if (STARTING_SOON_RE.test(t)) return "STARTING_SOON";
  return "NONE";
}

/** News headlines already come from construction searches; treat them as upcoming unless finished. */
export function inferNewsProjectStage(title: string, description = ""): ProjectStage {
  const stage = inferProjectStage(`${title} ${description}`);
  if (stage !== "NONE") return stage;
  return "STARTING_SOON";
}

export function isActiveConstructionStage(stage?: string | null): boolean {
  const n = normalizeProjectStage(stage);
  return n === "UNDERWAY" || n === "STARTING_SOON";
}

export function resolveConstructionStage(llmStage?: string | null, sourceText?: string): ProjectStage {
  const fromLlm = normalizeProjectStage(llmStage);
  if (fromLlm === "UNDERWAY" || fromLlm === "STARTING_SOON" || fromLlm === "COMPLETED") return fromLlm;
  if (sourceText) return inferProjectStage(sourceText);
  return fromLlm ?? "NONE";
}
