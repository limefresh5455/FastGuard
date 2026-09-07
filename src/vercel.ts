import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "./db/client";
import { ensureSchema } from "./db/ensureSchema";
import { buildApp } from "./api/app";

type App = Awaited<ReturnType<typeof buildApp>>;

let ready: Promise<App> | undefined;

async function getApp() {
  if (!ready) {
    ready = (async () => {
      const app = await buildApp();
      await app.ready();
      try {
        await ensureSchema(prisma);
      } catch (err) {
        app.log.warn({ err }, "ensureSchema skipped");
      }
      return app;
    })().catch((err) => {
      ready = undefined;
      throw err;
    });
  }
  return ready;
}

function sendError(res: ServerResponse, err: unknown) {
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : String(err);
  res.statusCode = 500;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Internal Server Error", message }));
}

export default async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    app.server.emit("request", req, res);
  } catch (err) {
    console.error(err);
    sendError(res, err);
  }
}
