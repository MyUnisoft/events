// Import Node.js Dependencies
import { createHmac } from "node:crypto";

// Import Third-party Dependencies
import fastify, { type FastifyRequest, type FastifyInstance } from "fastify";

// Import Internal Dependencies
import { webhooksAPI } from "./feature/webhook.js";

// CONSTANTS
const kSecret = "foo";

export function buildServer(): FastifyInstance {
  const app = fastify({
    logger: {
      level: "info"
    }
  });

  app.register(webhooksAPI, {
    prefix: "api/v1",
    preHandler: guard
  });

  return app;
}

async function guard(req: FastifyRequest): Promise<void> {
  const { headers, body } = req;

  const { signature, date } = headers;

  const generatedSignature = createHmac("sha256", kSecret)
    .update(JSON.stringify(body) + date)
    .digest("hex");

  if (signature !== generatedSignature) {
    throw new Error("Wrong signature");
  }
}

const server = buildServer();

server.listen({
  port: process.env.PORT ? Number(process.env.PORT) : 12080,
  host: process.env.HOST ?? "localhost"
}, function httpListeningCallback(err, addr) {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }

  server.log.info(`Server listening on ${addr}`);
});
