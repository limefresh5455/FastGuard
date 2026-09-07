import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "./db/client";
import { ensureSchema } from "./db/ensureSchema";
import { buildApp } from "./api/app";

type App = Awaited<ReturnType<typeof buildApp>>;

let ready: Promise<App> | undefined;

async function getApp() {
  if (!ready) {
    ready = buildApp().then(async (app) => {
      await app.ready();
      await ensureSchema(prisma);
      return app;
    });
  }
  return ready;
}

export default async function handle(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
