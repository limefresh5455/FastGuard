import { PrismaClient } from "@prisma/client";
import { env, prismaRuntimeUrl } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function isPrismaPostgresUrl(url: string) {
  return /^prisma(\+postgres)?:\/\//i.test(url);
}

function isLocalDbUrl(url: string) {
  return /@localhost[:/?]|@127\.0\.0\.1[:/?]/i.test(url);
}

function createPrisma(): PrismaClient {
  const url = env.DATABASE_URL && !(process.env.VERCEL && isLocalDbUrl(env.DATABASE_URL)) ? env.DATABASE_URL : "";
  const log: Array<"warn" | "error"> = env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];

  if (isPrismaPostgresUrl(url)) {
    // CJS require so Vercel does not crash on the ESM-only named export.
    const { withAccelerate } = require("@prisma/extension-accelerate") as {
      withAccelerate: () => never;
    };
    return new PrismaClient({ log }).$extends(withAccelerate()) as unknown as PrismaClient;
  }

  if (!url) {
    throw new Error(
      "DATABASE_URL is missing or is localhost. In Vercel Environment Variables, delete the localhost URL and connect Prisma Postgres with prefix DATABASE.",
    );
  }

  return new PrismaClient({
    log,
    datasources: { db: { url: prismaRuntimeUrl(url) } },
  });
}

function getClient() {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createPrisma();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
