import { PrismaClient } from "@prisma/client";
import { env, prismaRuntimeUrl } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma() {
  const url = env.DATABASE_URL;
  const log: Array<"warn" | "error"> = env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  if (/^prisma(\+postgres)?:\/\//i.test(url)) {
    return new PrismaClient({ log });
  }
  return new PrismaClient({
    log,
    datasources: { db: { url: prismaRuntimeUrl(url) } },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
