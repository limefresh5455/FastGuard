const LEGAL = /\b(llc|inc|corp|company|construction|management|security)\b/i;

export function scoreLead(params: {
  hasCompany: boolean;
  hasPersonContact: boolean;
  hasPhoneOrEmail: boolean;
  hasProject: boolean;
  hasTrigger: boolean;
  companyType?: string | null;
  aiScore?: number | null;
}): { total: number; breakdown: Record<string, number> } {
  if (params.aiScore != null && Number.isFinite(params.aiScore)) {
    const total = Math.max(0, Math.min(100, Math.round(params.aiScore)));
    return { total, breakdown: { ai: total } };
  }

  const breakdown: Record<string, number> = {
    company: params.hasCompany ? 20 : 0,
    contact: params.hasPersonContact ? 20 : 0,
    phoneEmail: params.hasPhoneOrEmail ? 15 : 0,
    project: params.hasProject ? 20 : 0,
    trigger: params.hasTrigger ? 15 : 0,
    fit: ["GENERAL_CONTRACTOR", "DEVELOPER", "PROPERTY_MANAGER", "CONSTRUCTION_COMPANY"].includes(
      params.companyType ?? "",
    )
      ? 10
      : 0,
  };
  const total = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { total, breakdown };
}

export function isPersonName(first?: string | null, last?: string | null): boolean {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  if (!name || LEGAL.test(name)) return false;
  return Boolean(first && last);
}
