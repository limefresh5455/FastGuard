import { prisma } from "../db/client";

export async function bumpSource(code: string, name: string, category: string, created: number) {
  await prisma.source.upsert({
    where: { code },
    create: { code, name, category, lastRunAt: new Date(), recordsCreated: created },
    update: { lastRunAt: new Date(), recordsCreated: { increment: created }, name, category },
  });
}

export async function seedDefaultSources() {
  const rows = [
    { code: "construction_news", name: "South Florida construction news", category: "news" },
    { code: "property_news", name: "South Florida property news", category: "news" },
    { code: "lookup_company", name: "Manual company lookup", category: "lookup" },
    { code: "lookup_address", name: "Manual address lookup", category: "lookup" },
    { code: "discover_signal", name: "Name + address discover", category: "news" },
    { code: "apollo_lookup", name: "Apollo company lookup", category: "lookup" },
    { code: "llm_lookup", name: "LLM company lookup (Apollo fallback)", category: "lookup" },
  ];
  for (const row of rows) {
    await prisma.source.upsert({
      where: { code: row.code },
      create: row,
      update: { name: row.name, category: row.category },
    });
  }
}
