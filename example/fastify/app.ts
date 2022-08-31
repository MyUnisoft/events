
// Import Third-party Dependencies
import fastify from "fastify";

// Import Types
import { FastifyInstance } from "fastify/types/instance";

// Import Internal Dependencies
import { webhooksAPI } from "./feature/webhook";

export function buildServer(): FastifyInstance {
  const app = fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty"
      }
    }
  });

  app.register(webhooksAPI, { prefix: "api/v1" });

  return app;
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
