const LEGAL_SUFFIXES = [
  "llc", "l.l.c", "inc", "incorporated", "corp", "corporation", "ltd", "co", "company", "lp", "llp", "pllc", "pc",
];

export function normalizeCompanyName(name: string): string {
  let n = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  n = n.replace(/[&]/g, " and ").replace(/[^a-z0-9\s]/g, " ");
  return n
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !LEGAL_SUFFIXES.includes(t))
    .join(" ")
    .trim();
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

export function looksLikeCompanyAsContactName(name?: string | null): boolean {
  if (!name?.trim()) return true;
  const n = name.trim();
  if (/\b(llc|inc\.?|corp\.?|ltd\.?|incorporated|corporation)\b/i.test(n)) return true;
  if (/^(mr|mrs|ms|dr|sir)\.?$/i.test(n)) return true;
  if (
    /^(project manager|superintendent|president|owner|principal|director of operations|vice president|ceo)$/i.test(
      n,
    )
  ) {
    return true;
  }
  if (/^\S+\s+(construction|management|security|properties|holdings|partners|development)$/i.test(n)) return true;
  return n.split(/\s+/).length < 2;
}

export function col(row: Record<string, unknown>, names: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().replace(/\s+/g, "") === n.toLowerCase().replace(/\s+/g, ""));
    if (k && row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return undefined;
}
