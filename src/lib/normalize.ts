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
  if (/\b(llc|inc|corp|company|construction|management|security|properties|holdings|partners|associates|realty|development)\b/i.test(name)) return true;
  return name.trim().split(/\s+/).length < 2;
}

export function col(row: Record<string, unknown>, names: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().replace(/\s+/g, "") === n.toLowerCase().replace(/\s+/g, ""));
    if (k && row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return undefined;
}
