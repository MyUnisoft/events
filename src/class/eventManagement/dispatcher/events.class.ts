// Import Node.js Dependencies
import { EventEmitter } from "node:events";

// Import Third-party Dependencies
import { Channel } from "@myunisoft/redis";
import Ajv, { ValidateFunction } from "ajv";
import { Logger } from "pino";
import { match } from "ts-pattern";

// Import Internal Dependencies
import { TransactionStore } from "../../store/transaction.class";
import {
  DispatcherChannelMessages,
  DispatcherApprovementMessage,
  EventMessage,
  GenericEvent,
  IncomerChannelMessages,
  IncomerRegistrationMessage,
  CloseMessage
} from "../../../types";
import * as eventsSchema from "../../../schema/eventManagement/index";
import { NestedValidationFunctions, StandardLog, defaultStandardLog } from "../../../utils";

// CONSTANTS
const ajv = new Ajv();
const kDispatcherChannelEvents = ["REGISTER", "APPROVEMENT"];

export type DispatcherChannelEvents = { name: "REGISTER" | "APPROVEMENT" };

type AnyDispatcherChannelMessage = (
  DispatcherChannelMessages["DispatcherMessages"] | DispatcherChannelMessages["IncomerMessages"]
);

type AnyIncomerChannelMessage<T extends GenericEvent> = (
  IncomerChannelMessages<T>["DispatcherMessages"] | IncomerChannelMessages<T>["IncomerMessages"]
);

function isIncomerChannelMessage<
  T extends GenericEvent
>(
  event: AnyDispatcherChannelMessage |
    AnyIncomerChannelMessage<T>
): event is IncomerChannelMessages<T>["IncomerMessages"] {
  return kDispatcherChannelEvents.find((message) => message === event.name) === undefined;
}

function isDispatcherChannelMessage<
  T extends GenericEvent
>(
  event: AnyDispatcherChannelMessage |
    AnyIncomerChannelMessage<T>
): event is AnyDispatcherChannelMessage {
  return kDispatcherChannelEvents.find((message) => message === event.name) !== undefined;
}

function isCustomEventMessage<T extends GenericEvent>(
  event: IncomerChannelMessages<T>["IncomerMessages"]
): event is EventMessage<T> {
  return event.name !== "CLOSE";
}

function isCloseMessage<T extends GenericEvent>(
  event: IncomerChannelMessages<T>["IncomerMessages"]
): event is CloseMessage {
  return event.name === "CLOSE";
}

type DispatchedEvent<T extends GenericEvent> = (
  IncomerChannelMessages<T>["DispatcherMessages"] | DispatcherApprovementMessage
) & {
  redisMetadata: Omit<DispatcherChannelMessages["DispatcherMessages"]["redisMetadata"], "transactionId">
};

export interface DispatchEventOptions<T extends GenericEvent> {
  channel: Channel<IncomerChannelMessages<T>["DispatcherMessages"] | DispatcherApprovementMessage>;
  event: DispatchedEvent<T>;
  redisMetadata: {
    mainTransaction: boolean;
    relatedTransaction?: null | string;
    eventTransactionId?: null | string;
    resolved: boolean;
  };
  store: TransactionStore<"incomer"> | TransactionStore<"dispatcher">;
}

export type customValidationCbFn<T extends GenericEvent> = (event: T) => void;
export type eventsValidationFn<T extends GenericEvent> = Map<string, ValidateFunction<T> | NestedValidationFunctions>;

export interface EventsHandlerOptions<T extends GenericEvent> {
  privateUUID: string;
  dispatcherChannelName: string;
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    customValidationCbFn?: customValidationCbFn<T>;
  };
  standardLog?: StandardLog<T>;
  parentLogger: Partial<Logger> & Pick<Logger, "info" | "warn" | "error">;
}

export class EventsHandler<T extends GenericEvent> extends EventEmitter {
  readonly privateUUID: string;
  readonly dispatcherChannelName: string;

  #eventsValidationFn: eventsValidationFn<T>;
  #customValidationCbFn: customValidationCbFn<T>;

  #logger: Partial<Logger> & Pick<Logger, "info" | "warn" | "error">;
  #standardLogFn: StandardLog<T>;

  constructor(options: EventsHandlerOptions<T>) {
    super();

    Object.assign(this, { ...options });

    this.#logger = options.parentLogger.child({ module: "events-handler" });
    this.#standardLogFn = options.standardLog ?? defaultStandardLog;

    this.#eventsValidationFn = options.eventsValidation?.eventsValidationFn ?? new Map();
    this.#customValidationCbFn = options.eventsValidation?.customValidationCbFn;

    for (const [eventName, validationSchema] of Object.entries(eventsSchema)) {
      this.#eventsValidationFn.set(eventName, ajv.compile(validationSchema));
    }
  }

  public async dispatch(options: DispatchEventOptions<T>): Promise<void> {
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

  public async handleEvents(
    channel: string,
    event: AnyDispatcherChannelMessage |
    AnyIncomerChannelMessage<T>
  ) {
    if (!event.name || !event.redisMetadata) {
      throw new Error("Malformed message");
    }

    if (event.redisMetadata.origin === this.privateUUID) {
      return;
    }

    if (channel === this.dispatcherChannelName && isDispatcherChannelMessage(event)) {
      try {
        this.dispatcherChannelMessagesSchemaValidation(event);
      }
      catch (error) {
        this.#logger.error({
          channel,
          message: event,
          error: error.stack
        });
      }

      match<DispatcherChannelEvents>({ name: event.name })
        .with({ name: "REGISTER" }, async() => {
          this.#logger.info({ channel, event }, "Registration asked");

          this.emit("APPROVEMENT", event);
        })
        .otherwise(() => {
          throw new Error("Unknown Event");
        });
    }
    else if (isIncomerChannelMessage(event)) {
      this.IncomerChannelMessagesSchemaValidation(event);

      if (isCloseMessage(event)) {
        this.emit("CLOSE", channel, event);

        return;
      }

      this.emit("CUSTOM_EVENT", channel, event);
    }
    else {
      throw new Error("Unknown event for the given Channel");
    }
  }

  private redisMetadataValidation(event: AnyDispatcherChannelMessage | AnyIncomerChannelMessage<T>) {
    const { redisMetadata } = event;

    const redisMetadataValidationFn = this.#eventsValidationFn.get("redisMetadata") as ValidateFunction<T>;

    if (!redisMetadataValidationFn(redisMetadata)) {
      throw new Error(
        `Malformed redis metadata: [${[...redisMetadataValidationFn.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
    }
  }

  private dispatcherChannelMessagesSchemaValidation(
    event: IncomerRegistrationMessage | DispatcherApprovementMessage
  ): void {
    const { redisMetadata, ...eventRest } = event;

    this.redisMetadataValidation(event);

    const eventValidation = this.#eventsValidationFn.get(eventRest.name) as ValidateFunction<T>;

    if (!eventValidation) {
      throw new Error(`Cannot find the related validation schema for the event: ${event.name}`);
    }

    if (!eventValidation(eventRest)) {
      throw new Error(
        `Malformed event: [${[...eventValidation.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
    }
  }

  private IncomerChannelMessagesSchemaValidation(
    event: IncomerChannelMessages<T>["IncomerMessages"]
  ): void {
    const { redisMetadata, ...eventRest } = event;

    this.redisMetadataValidation(event);

    if (event.name === "CLOSE") {
      return;
    }

    const eventValidation = this.#eventsValidationFn.get(eventRest.name) as ValidateFunction<T>;

    if (!eventValidation) {
      throw new Error(`Unknown Event ${event.name}`);
    }

    if (this.#customValidationCbFn && isCustomEventMessage(event)) {
      this.#customValidationCbFn({ ...event });

      return;
    }

    if (!eventValidation(eventRest)) {
      throw new Error(
        `Malformed event: [${[...eventValidation.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
    }
  }
}
