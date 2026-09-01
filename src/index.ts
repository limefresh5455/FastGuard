import { env } from "./config/env";
import { buildApp } from "./api/app";
import { logger } from "./lib/logger";

async function main() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`Fast Guard MVP on :${env.PORT}  docs=/docs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
