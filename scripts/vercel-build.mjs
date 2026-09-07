import { spawnSync } from "node:child_process";
import { appDatabaseUrl, isLocalDbUrl, migrateDatabaseUrl } from "./prisma-url.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/prisma-generate.mjs"]);

const migrateUrl = migrateDatabaseUrl();
if (!migrateUrl || isLocalDbUrl(migrateUrl)) {
  const appUrl = appDatabaseUrl();
  console.warn(
    !appUrl
      ? "Skipping prisma db push: no hosted DATABASE_URL. In Vercel, connect Prisma Postgres (prefix DATABASE). Do not use localhost."
      : "Skipping prisma db push: no reachable postgres:// URL (Prisma Postgres uses prisma+postgres://). Tables are created at runtime.",
  );
  process.exit(0);
}

process.env.DATABASE_URL = migrateUrl;
run("npx", ["prisma", "db", "push"]);
