export function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function isPrismaProtocol(url) {
  return /^prisma(\+postgres)?:\/\//i.test(url);
}

export function isTcpPostgres(url) {
  return /^(postgres|postgresql):\/\//i.test(url);
}

export function appDatabaseUrl() {
  return firstEnv("DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "PRISMA_DATABASE_URL", "STORAGE_URL");
}

export function migrateDatabaseUrl() {
  const candidates = [
    firstEnv("DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED"),
    appDatabaseUrl(),
  ].filter(Boolean);
  return candidates.find(isTcpPostgres) || "";
}

export const GENERATE_PLACEHOLDER = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
