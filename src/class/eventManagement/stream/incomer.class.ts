// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Interpersonal,
  InterpersonalOptions,
  Stream
} from "@myunisoft/redis";

// Import Internal Dependencies
import { GenericEvent } from "types";

export type IncomerStreamOptions = InterpersonalOptions & {
  eventsSubscribe: (GenericEvent & {
    horizontalScale?: boolean;
  })[];
}

export class IncomerStream {
  public interpersonal: Interpersonal;
  public streams = new Map<string, Stream>();

  constructor(options: IncomerStreamOptions) {
    for (const subscribedEvent of options.eventsSubscribe) {
      const { horizontalScale, ...event } = subscribedEvent;

      if (horizontalScale) {
        const groupName = `${options.groupName}-${randomUUID}`;
        const consumerName = randomUUID();

        // const stream = await
      }
    }

    Object.assign(this, options);
  }

  public async init(): Promise<void> {
    //
  }

  public async publish() {
    //
  }
}
