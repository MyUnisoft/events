// Import Third-party Dependencies
import type {
  FastifyRequest,
  FastifyReply,
  FastifyInstance
} from "fastify";

// Import Internal Dependencies
import * as MyEvents from "../../../src/index.js";

export async function webhooksAPI(server: FastifyInstance) {
  server.post("/anyEvents", getAnyWebhooks);
  server.post("/connector", getConnectorWebhooks);
}

type GetAnyWebhooksRequest = FastifyRequest<{
  Headers: {
    date: string;
    signature: string;
  };
  Body: MyEvents.WebhooksResponse;
}>;

async function getAnyWebhooks(
  request: GetAnyWebhooksRequest,
  reply: FastifyReply
) {
  // Do some code
}

type GetConnectorWebhooksRequest = FastifyRequest<{
  Headers: {
    date: string;
    signature: string;
  };
  Body: MyEvents.WebhooksResponse<["connector"]>;
}>;

async function getConnectorWebhooks(
  request: GetConnectorWebhooksRequest,
  reply: FastifyReply
) {
  // Do some code
}
