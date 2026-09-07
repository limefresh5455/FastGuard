import { spawnSync } from "node:child_process";
import { appDatabaseUrl, migrateDatabaseUrl } from "./prisma-url.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/prisma-generate.mjs"]);

const migrateUrl = migrateDatabaseUrl();
if (!migrateUrl) {
  const appUrl = appDatabaseUrl();
  console.warn(
    appUrl
      ? "Skipping prisma db push: DATABASE_URL is prisma+postgres://. Add a postgres:// DIRECT_URL from Prisma Console if you need the schema pushed during deploy."
      : "Skipping prisma db push: no DATABASE_URL.",
  );
  process.exit(0);
}

process.env.DATABASE_URL = migrateUrl;
run("npx", ["prisma", "db", "push"]);
