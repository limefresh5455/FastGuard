import { looksLikeCompanyAsContactName, normalizePhone } from "./normalize";

export type PersonHit = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
};

const GENERIC_LOCAL =
  /^(info|contact|sales|office|admin|hello|support|marketing|bids|estimating|webmaster|noreply|no-?reply|mail|general|inquiries|enquiry|hr|jobs|careers|media|press|reception)$/i;

const TITLE_RE =
  /((?:senior |assistant |executive |general |vice )?(?:project superintendent|superintendent|project manager|property manager|director of operations|director of construction|vice president|president|chief executive officer|managing partner|managing director|project executive|operations manager|preconstruction manager|site superintendent|owner|principal|partner|estimator|ceo|coo|cfo))/i;

const NAME_PART = "([A-Z][a-z]+|[A-Z]{2,})(?:\\s+(?:de|la|del|van|von|da|di))?\\s+([A-Z][a-z]+(?:[\\s'-][A-Z][a-z]+)?|[A-Z]{2,})";

export const SOUTH_FL_CITIES = [
  "Miami",
  "Miami Beach",
  "Coral Gables",
  "Doral",
  "Hialeah",
  "Homestead",
  "Kendall",
  "Aventura",
  "Fort Lauderdale",
  "Hollywood",
  "Pompano Beach",
  "Deerfield Beach",
  "Boca Raton",
  "West Palm Beach",
  "Palm Beach",
  "Delray Beach",
  "Boynton Beach",
  "Sunrise",
  "Plantation",
  "Davie",
  "Weston",
  "Pembroke Pines",
  "Miramar",
  "Hallandale",
  "Jupiter",
];

export function isGenericEmail(email?: string | null): boolean {
  if (!email?.includes("@")) return true;
  const local = email.split("@")[0] ?? "";
  return GENERIC_LOCAL.test(local);
}

export function titleCaseName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return s;
  if (s === s.toUpperCase() || s === s.toLowerCase()) {
    return s
      .toLowerCase()
      .split(" ")
      .map((w) => (["de", "la", "del", "van", "von", "da", "di"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  return s;
}

export function splitFullName(full?: string | null): { firstName: string | null; lastName: string | null; title: string | null } {
  let raw = (full ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { firstName: null, lastName: null, title: null };

  let title: string | null = null;
  const titled = raw.match(new RegExp(`^${NAME_PART}\\s*[,\\-|–]\\s*(${TITLE_RE.source})\\s*$`, "i"));
  if (titled) {
    raw = `${titled[1]} ${titled[2]}`.replace(/\s+/g, " ").trim();
    title = titled[3].trim();
  } else {
    const trailing = raw.match(new RegExp(`^(.*?)\\s*[,\\-|–]\\s*(${TITLE_RE.source})\\s*$`, "i"));
    if (trailing) {
      raw = trailing[1].trim();
      title = trailing[2].trim();
    }
  }

  raw = raw.replace(/^(mr|mrs|ms|dr|sir)\.?\s+/i, "");
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: titleCaseName(parts[0] || "") || null, lastName: null, title };
  return {
    firstName: titleCaseName(parts[0]),
    lastName: titleCaseName(parts.slice(1).join(" ")),
    title: title ? titleCaseName(title) : null,
  };
}

export function nameFromEmail(email?: string | null): { firstName: string | null; lastName: string | null } | null {
  if (!email?.includes("@") || isGenericEmail(email)) return null;
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter((p) => p.length > 1 && !/^\d+$/.test(p) && !GENERIC_LOCAL.test(p));
  if (parts.length < 2) return null;
  return {
    firstName: titleCaseName(parts[0]),
    lastName: titleCaseName(parts.slice(1).join(" ")),
  };
}

export function looksLikeNewsHeadline(name: string): boolean {
  const n = name.trim();
  if (n.length > 70) return true;
  if (/\b(breaks? ground|under construction|groundbreaking|announces|million|billion|to build|plans for|permit issued)\b/i.test(n)) {
    return true;
  }
  return (n.match(/,/g) || []).length >= 2;
}

export function companyNameFromNews(title: string, description = ""): string {
  const blob = `${title}. ${description}`;
  const patterns = [
    /\b(?:general contractor|contractor)\s+([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,5}(?:\s+(?:LLC|Inc\.?|Group|Construction|Contractors|Associates|Partners))?)/,
    /\b(?:developer|developed by|owned by|owner)\s+([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,5}(?:\s+(?:LLC|Inc\.?|Group|Developers?|Partners|Holdings))?)/,
    /\b([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,4}\s+(?:Construction|Contractors|Developers|Development|Holdings|Partners|Associates))\b/,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    const guess = m?.[1]?.trim();
    if (guess && guess.length < 80 && !looksLikeNewsHeadline(guess)) return guess.slice(0, 120);
  }
  const first = title.split(/[:\-–|]/)[0].trim();
  if (
    first.length < 55 &&
    /\b(llc|inc|corp|construction|group|partners|associates|developers?|contractors?)\b/i.test(first)
  ) {
    return first.slice(0, 120);
  }
  return (first || title).slice(0, 120);
}

export function moneyInText(text: string): number | null {
  const m = text.match(/\$\s*([\d,.]+)\s*(million|billion)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (/million/i.test(m[2] ?? "")) n *= 1_000_000;
  if (/billion/i.test(m[2] ?? "")) n *= 1_000_000_000;
  return n;
}

export function cityFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const city of SOUTH_FL_CITIES) {
    if (lower.includes(city.toLowerCase())) return city;
  }
  return null;
}

export function urlsInText(text: string): string[] {
  return [...(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])].map((u) => u.replace(/[),.;]+$/, ""));
}

function pushPerson(out: PersonHit[], first: string, last: string, title?: string | null, email?: string | null, phone?: string | null) {
  const firstName = titleCaseName(first);
  const lastName = titleCaseName(last);
  const label = `${firstName} ${lastName}`.trim();
  if (!firstName || !lastName) return;
  if (/^(the|a|an|south|fort|new|west|east|north|palm|boca|city|county)$/i.test(firstName)) return;
  if (looksLikeCompanyAsContactName(label)) return;
  if (out.some((p) => p.firstName === firstName && p.lastName === lastName)) {
    const existing = out.find((p) => p.firstName === firstName && p.lastName === lastName)!;
    existing.title = existing.title || (title ? titleCaseName(title) : null);
    existing.email = existing.email || email || null;
    existing.phone = existing.phone || phone || null;
    return;
  }
  out.push({
    firstName,
    lastName,
    title: title ? titleCaseName(title) : null,
    email: email || null,
    phone: phone || null,
  });
}

export function peopleFromText(text: string): PersonHit[] {
  const out: PersonHit[] = [];
  const t = text.replace(/\s+/g, " ");

  const commaTitle = new RegExp(`${NAME_PART}\\s*,\\s*(?:the\\s+)?${TITLE_RE.source}`, "g");
  for (const m of t.matchAll(commaTitle)) {
    pushPerson(out, m[1], m[2], m[3]);
  }
  const titleThenName = new RegExp(`${TITLE_RE.source}\\s+${NAME_PART}`, "g");
  for (const m of t.matchAll(titleThenName)) {
    pushPerson(out, m[2], m[3], m[1]);
  }
  const isThe = new RegExp(`${NAME_PART}\\s+is\\s+(?:the\\s+|a\\s+)?${TITLE_RE.source}`, "g");
  for (const m of t.matchAll(isThe)) {
    pushPerson(out, m[1], m[2], m[3]);
  }
  return out.slice(0, 12);
}

function walkJsonLd(node: unknown, out: PersonHit[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const type = String(o["@type"] ?? "");
  if (/person/i.test(type)) {
    const name = typeof o.name === "string" ? o.name : "";
    const split = splitFullName(name);
    const email = typeof o.email === "string" ? o.email : null;
    const phone = typeof o.telephone === "string" ? normalizePhone(o.telephone) : null;
    const title = typeof o.jobTitle === "string" ? o.jobTitle : split.title;
    if (split.firstName && split.lastName) {
      pushPerson(out, split.firstName, split.lastName, title, email, phone);
    }
  }
  if (o["@graph"]) walkJsonLd(o["@graph"], out);
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") walkJsonLd(v, out);
  }
}

export function peopleFromHtml(html: string): PersonHit[] {
  const out: PersonHit[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walkJsonLd(JSON.parse(m[1]), out);
    } catch {
      /* ignore broken json-ld */
    }
  }
  for (const m of html.matchAll(/<a[^>]+href=["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const email = decodeURIComponent(m[1]).replace(/^mailto:/i, "").trim().toLowerCase();
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const split = splitFullName(label.includes("@") ? "" : label);
    const fromEmail = nameFromEmail(email);
    const first = split.firstName || fromEmail?.firstName;
    const last = split.lastName || fromEmail?.lastName;
    if (first && last && !isGenericEmail(email)) pushPerson(out, first, last, split.title, email);
  }
  return out;
}

export function mergePeople(...lists: PersonHit[][]): PersonHit[] {
  const out: PersonHit[] = [];
  for (const list of lists) {
    for (const p of list) {
      const email = p.email?.toLowerCase() || null;
      const inferred = email ? nameFromEmail(email) : null;
      const split = splitFullName([p.firstName, p.lastName].filter(Boolean).join(" "));
      const firstName = split.firstName || inferred?.firstName || p.firstName || null;
      const lastName = split.lastName || inferred?.lastName || p.lastName || null;
      const title = p.title || split.title;
      if (email && isGenericEmail(email) && !(firstName && lastName)) continue;
      if (!(firstName && lastName) && !email) continue;
      const existing = out.find(
        (x) =>
          (email && x.email === email) ||
          (firstName && lastName && x.firstName?.toLowerCase() === firstName.toLowerCase() && x.lastName?.toLowerCase() === lastName.toLowerCase()),
      );
      if (existing) {
        existing.firstName = existing.firstName || firstName;
        existing.lastName = existing.lastName || lastName;
        existing.title = existing.title || title;
        existing.email = existing.email || email;
        existing.phone = existing.phone || p.phone;
        continue;
      }
      out.push({ firstName, lastName, title, email, phone: p.phone || null });
    }
  }
  return out;
}

export function normalizeLooseContact(raw: unknown): PersonHit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null") return v.trim();
    }
    return null;
  };
  const email = str("email", "emailAddress", "email_address")?.toLowerCase() || null;
  const phone = normalizePhone(str("phone", "phoneNumber", "phone_number", "mobile", "telephone"));
  const title = str("title", "job_title", "jobTitle", "role", "position");
  const full = str("name", "fullName", "full_name", "contact");
  let firstName = str("firstName", "first_name", "first");
  let lastName = str("lastName", "last_name", "last");
  if ((!firstName || !lastName) && full) {
    const split = splitFullName(full);
    firstName = firstName || split.firstName;
    lastName = lastName || split.lastName;
  } else if (firstName && !lastName) {
    const split = splitFullName(firstName);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  if ((!firstName || !lastName) && email) {
    const inferred = nameFromEmail(email);
    firstName = firstName || inferred?.firstName || null;
    lastName = lastName || inferred?.lastName || null;
  }
  if (isGenericEmail(email) && !(firstName && lastName)) return null;
  if (!(firstName && lastName) && !email) return null;
  return { firstName, lastName, title, email, phone };
}
