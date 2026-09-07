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

export function isLocalDbUrl(url) {
  return /@localhost[:/?]|@127\.0\.0\.1[:/?]/i.test(url);
}

const HOSTED_KEYS = [
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_DATABASE_URL",
  "PRISMA_DATABASE_URL",
  "STORAGE_URL",
];

export function appDatabaseUrl() {
  const onVercel = Boolean(process.env.VERCEL);
  const candidates = [
    process.env.DATABASE_URL,
    ...HOSTED_KEYS.map((key) => process.env[key]),
  ]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (onVercel) {
    const hosted = candidates.find((url) => !isLocalDbUrl(url));
    return hosted || "";
  }
  return candidates[0] || "";
}

export function migrateDatabaseUrl() {
  const onVercel = Boolean(process.env.VERCEL);
  const candidates = [
    firstEnv("DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED"),
    appDatabaseUrl(),
  ].filter(Boolean);
  const tcp = candidates.filter(isTcpPostgres);
  if (onVercel) return tcp.find((url) => !isLocalDbUrl(url)) || "";
  return tcp[0] || "";
}

export const GENERATE_PLACEHOLDER = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
