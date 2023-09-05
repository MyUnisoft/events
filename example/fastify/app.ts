// Import Node.js Dependencies
import { createHmac } from "crypto";

// Import Third-party Dependencies
import fastify, { FastifyRequest } from "fastify";

// Import Types
import { FastifyInstance } from "fastify/types/instance";

// Import Internal Dependencies
import { webhooksAPI } from "./feature/webhook";

// CONSTANTS
const kSecret = "foo";

export function buildServer(): FastifyInstance {
  const app = fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty"
      }
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
