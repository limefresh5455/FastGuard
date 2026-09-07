import { PrismaClient } from "@prisma/client";
import { env, prismaRuntimeUrl } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    datasources: { db: { url: prismaRuntimeUrl(env.DATABASE_URL) } },
  });

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
