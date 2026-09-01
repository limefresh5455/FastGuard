import { prisma } from "../db/client";
import { normalizeCompanyName, normalizePhone } from "../lib/normalize";

function domainOf(website?: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sameCompany(a: { name: string; website: string | null; phone: string | null }, b: typeof a): boolean {
  if (normalizeCompanyName(a.name) && normalizeCompanyName(a.name) === normalizeCompanyName(b.name)) return true;
  const da = domainOf(a.website);
  const db = domainOf(b.website);
  if (da && db && da === db) return true;
  const pa = normalizePhone(a.phone);
  const pb = normalizePhone(b.phone);
  if (pa && pb && pa === pb && normalizeCompanyName(a.name).slice(0, 8) === normalizeCompanyName(b.name).slice(0, 8)) {
    return true;
  }
  return false;
}

async function mergeInto(winnerId: string, loserId: string) {
  if (winnerId === loserId) return;
  await prisma.contact.updateMany({ where: { companyId: loserId }, data: { companyId: winnerId } });
  await prisma.project.updateMany({ where: { companyId: loserId }, data: { companyId: winnerId } });
  await prisma.triggerEvent.updateMany({ where: { companyId: loserId }, data: { companyId: winnerId } });
  await prisma.lead.updateMany({ where: { companyId: loserId }, data: { companyId: winnerId } });
  const winner = await prisma.company.findUnique({ where: { id: winnerId } });
  const loser = await prisma.company.findUnique({ where: { id: loserId } });
  if (winner && loser) {
    await prisma.company.update({
      where: { id: winnerId },
      data: {
        website: winner.website || loser.website,
        phone: winner.phone || loser.phone,
        city: winner.city || loser.city,
        state: winner.state || loser.state,
        sourceUrl: winner.sourceUrl || loser.sourceUrl,
      },
    });
  }
  await prisma.company.delete({ where: { id: loserId } });
}

export async function runDuplicateCheck() {
  const companies = await prisma.company.findMany({ orderBy: { createdAt: "asc" } });
  let merged = 0;
  const used = new Set<string>();
  for (let i = 0; i < companies.length; i++) {
    if (used.has(companies[i].id)) continue;
    for (let j = i + 1; j < companies.length; j++) {
      if (used.has(companies[j].id)) continue;
      if (!sameCompany(companies[i], companies[j])) continue;
      await mergeInto(companies[i].id, companies[j].id);
      used.add(companies[j].id);
      merged += 1;
    }
  }
  return { companiesScanned: companies.length, merged };
}
