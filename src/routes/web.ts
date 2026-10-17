import staticPlugin from "@fastify/static";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

export const registerWebRoutes = async (app: FastifyInstance): Promise<void> => {
  const webDist = path.resolve(process.cwd(), "web", "dist");
  if (!fs.existsSync(webDist)) {
    app.get("/", async (_request, reply) =>
      reply.code(404).send({ error: { message: "Console is not built. Run npm run build:web (or build.cmd)." } }));
    app.get("/app", async (_request, reply) =>
      reply.code(404).send({ error: { message: "Console is not built. Run npm run build:web (or build.cmd)." } }));
    return;
  }

  await app.register(staticPlugin, {
    root: webDist,
    prefix: "/app/",
    decorateReply: false,
  });

  app.get("/", async (_request, reply) => reply.redirect("/app/"));
  app.get("/app", async (_request, reply) => reply.redirect("/app/"));
};
