import { prisma } from "../db/client";

const TABLES = `"Lead", "Contact", "TriggerEvent", "Project", "Company", "sources"`;

export async function truncateAllTables() {
  const deleted = {
    leads: await prisma.lead.count(),
    contacts: await prisma.contact.count(),
    triggers: await prisma.triggerEvent.count(),
    projects: await prisma.project.count(),
    companies: await prisma.company.count(),
    sources: await prisma.source.count(),
  };

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`);
  } catch {
    await prisma.$transaction([
      prisma.lead.deleteMany(),
      prisma.contact.deleteMany(),
      prisma.triggerEvent.deleteMany(),
      prisma.project.deleteMany(),
      prisma.company.deleteMany(),
      prisma.source.deleteMany(),
    ]);
  }

  return {
    ok: true,
    deleted,
    remaining: {
      leads: await prisma.lead.count(),
      contacts: await prisma.contact.count(),
      triggers: await prisma.triggerEvent.count(),
      projects: await prisma.project.count(),
      companies: await prisma.company.count(),
      sources: await prisma.source.count(),
    },
  };
}
