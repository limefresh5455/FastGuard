import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { env, prismaRuntimeUrl } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function isPrismaPostgresUrl(url: string) {
  return /^prisma(\+postgres)?:\/\//i.test(url);
}

function createPrisma(): PrismaClient {
  const log: Array<"warn" | "error"> = env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  if (isPrismaPostgresUrl(env.DATABASE_URL)) {
    return new PrismaClient({ log }).$extends(withAccelerate() as never) as unknown as PrismaClient;
  }
  return new PrismaClient({
    log,
    datasources: { db: { url: prismaRuntimeUrl(env.DATABASE_URL) } },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
