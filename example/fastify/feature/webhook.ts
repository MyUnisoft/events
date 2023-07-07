// Import Node.js Dependencies
import { createHmac } from "crypto";

// Import Internal Dependencies
import * as MyEvents from "../../../src/index";

// Import types
import {
  FastifyRequest,
  FastifyReply,
  FastifyInstance
} from "fastify";

const kMyUnisoftToken = process.env.THIRD_PARTY_SECRET!;

export async function webhooksAPI(server: FastifyInstance) {
  server.post("/anyEvents", { preHandler: signPayload }, getAnyWebhooks);
  server.post("/connector", { preHandler: signPayload }, getConnectorWebhooks);
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

function signPayload(req: GetAnyWebhooksRequest, reply: FastifyReply, done) {
  const webhooks = req.body;
  const { date, signature } = req.headers;

  const signed = createHmac("sha256", kMyUnisoftToken)
    .update(JSON.stringify({ webhooks, date }))
    .digest("hex");

  if (signed !== signature) {
    reply.status(401).send();
  }

  done();
}

