import { spawnSync } from "node:child_process";
import { GENERATE_PLACEHOLDER, appDatabaseUrl, isPrismaProtocol } from "./prisma-url.mjs";

const realUrl = appDatabaseUrl();
if (isPrismaProtocol(realUrl)) {
  process.env.DATABASE_URL = GENERATE_PLACEHOLDER;
} else if (realUrl) {
  process.env.DATABASE_URL = realUrl;
} else {
  process.env.DATABASE_URL = GENERATE_PLACEHOLDER;
}

const result = spawnSync("npx", ["prisma", "generate"], { stdio: "inherit", shell: true, env: process.env });
process.exit(result.status ?? 1);
