// Import Node.js Dependencies
import { EventEmitter } from "node:events";

// Import Third-party Dependencies
import { Channel } from "@myunisoft/redis";

// Import Internal Dependencies
import { TransactionStore } from "class/store/transaction.class";
import {
  DispatcherChannelMessages,
  GenericEvent,
  IncomerChannelMessages
} from "../../../types";

type DispatchedEvent<T extends GenericEvent> = (
  IncomerChannelMessages<T>["DispatcherMessages"] | DispatcherChannelMessages["DispatcherMessages"]
) & {
  redisMetadata: Omit<DispatcherChannelMessages["DispatcherMessages"]["redisMetadata"], "transactionId">
};

export interface DispatchEventOptions<T extends GenericEvent> {
  channel: Channel<IncomerChannelMessages<T>["DispatcherMessages"] | DispatcherChannelMessages["DispatcherMessages"]>;
  event: DispatchedEvent<T>;
  redisMetadata: {
    mainTransaction: boolean;
    relatedTransaction?: null | string;
    eventTransactionId?: null | string;
    resolved: boolean;
  };
  store: TransactionStore<"incomer"> | TransactionStore<"dispatcher">;
}

export class EventsHandler<T extends GenericEvent> extends EventEmitter {
  public async dispatch(options: DispatchEventOptions<T>) {
    const { channel, store, redisMetadata, event } = options;

    const transaction = await store.setTransaction({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        ...redisMetadata
      } as any
    });

    await channel.publish({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        eventTransactionId: redisMetadata.eventTransactionId,
        transactionId: transaction.redisMetadata.transactionId
      }
    });
  }
}
