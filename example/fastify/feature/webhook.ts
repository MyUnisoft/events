// Import Internal Dependencies
import * as MyEvents from "../../../src/index";

// Import types
import {
  FastifyRequest,
  FastifyReply,
  FastifyInstance
} from "fastify";

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

async function getAnyWebhooks(req: GetAnyWebhooksRequest, reply: FastifyReply) {
  // Do some code
}

type GetConnectorWebhooksRequest = FastifyRequest<{
  Headers: {
    date: string;
    signature: string;
  };
  Body: MyEvents.WebhooksResponse<["connector"]>;
}>;

async function getConnectorWebhooks(req: GetConnectorWebhooksRequest, reply: FastifyReply) {
  // Do some code
}
