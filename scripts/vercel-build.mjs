import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  process.env.PRISMA_DATABASE_URL ||
  "";

if (databaseUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl;

run("npx", ["prisma", "generate"]);

if (!process.env.DATABASE_URL) {
  console.warn("Skipping prisma db push: DATABASE_URL is not set. Connect Prisma Postgres (prefix DATABASE) and redeploy.");
  process.exit(0);
}

run("npx", ["prisma", "db", "push"]);
