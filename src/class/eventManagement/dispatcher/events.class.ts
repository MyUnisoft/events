// Import Node.js Dependencies
import { EventEmitter } from "node:events";

// Import Third-party Dependencies
import { Channel } from "@myunisoft/redis";
import { Err, Ok, Result } from "@openally/result";

// Import Internal Dependencies
import { TransactionStore } from "class/store/transaction.class";
import {
  DispatcherChannelMessages,
  EventMessage,
  GenericEvent,
  IncomerChannelMessages
} from "../../../types";
import Ajv, { ValidateFunction } from "ajv";
import { NestedValidationFunctions } from "utils";
import * as eventsSchema from "../../../schema/eventManagement/index";

// CONSTANTS
const ajv = new Ajv();

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

export type ValidationCbFn<T extends GenericEvent> = (event: T) => Result<void, string>;
export type eventsValidationFn<T extends GenericEvent> = Map<string, ValidateFunction<T> | NestedValidationFunctions>;

export interface EventsHandlerOptions<T extends GenericEvent> {
  privateUUID: string;
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    validationCbFn?: ValidationCbFn<T>;
  }
}

type Foo<T extends GenericEvent> = {
  validationCbFn?: ValidationCbFn<T>;
}

export class EventsHandler<T extends GenericEvent> extends EventEmitter implements Foo<T> {
  readonly privateUUID: string;

  #eventsValidationFn: eventsValidationFn<T>;
  validationCbFn: ValidationCbFn<T>;

  constructor(options: EventsHandlerOptions<T>) {
    super();

    this.privateUUID = options.privateUUID;

    this.#eventsValidationFn = options.eventsValidation?.eventsValidationFn ?? new Map();
    this.validationCbFn = options?.eventsValidation?.validationCbFn;

    for (const [eventName, validationSchema] of Object.entries(eventsSchema)) {
      this.#eventsValidationFn.set(eventName, ajv.compile(validationSchema));
    }
  }

  public async dispatch(options: DispatchEventOptions<T>): Promise<Result<void, string>> {
    const { channel, store, redisMetadata, event } = options;

    try {
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
    catch (error) {
      return Err(error);
    }

    return Ok(void 0);
  }

  public async handleEvents(
    channel: string,
    event: DispatcherChannelMessages["IncomerMessages"] |
      IncomerChannelMessages<T>["IncomerMessages"]
  ) {
    // Event validation

    if (event.redisMetadata.origin === this.privateUUID) {
      return;
    }
  }

  private schemaValidation(
    event: DispatcherChannelMessages["IncomerMessages"] |
      IncomerChannelMessages<T>["IncomerMessages"]
  ): Result<void, string> {
    const { redisMetadata, ...eventRest } = event;

    const eventValidation = this.#eventsValidationFn.get(eventRest.name);
    const redisMetadataValidationFn = this.#eventsValidationFn.get("redisMetadata") as ValidateFunction<Record<string, any>>;

    if (!redisMetadataValidationFn(redisMetadata)) {
      throw new Error(
        `Malformed redis metadata: [${[...redisMetadataValidationFn.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
    }

    if (isIncomerChannelMessage(event)) {
      if (isEventMessage(event)) {
        return this.validationCbFn(event) ?? eventValidation(event);
      }
    }

    if (!eventValidation && !this.validationCbFn) {
      if (!this.validationCbFn) {
        throw new Error(`Unknown Event ${eventRest.name}`);
      }

      if (isIncomerChannelMessage(event)) {
        return this.validationCbFn(eventRest as EventMessage<T>);
      }
    }

    return void 0;
  }
}

const dispatcherMessages = ["approvement", "foo", "bar"];
function isIncomerChannelMessage<T extends GenericEvent>(
  foo: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages<T>["IncomerMessages"]
): foo is IncomerChannelMessages<T>["IncomerMessages"] {
  return !dispatcherMessages.find((message) => message !== foo.name);
}

function isEventMessage<T extends GenericEvent>(
  foo: IncomerChannelMessages<T>["IncomerMessages"]
): foo is EventMessage<T> {
  return foo.name !== "register";
}
