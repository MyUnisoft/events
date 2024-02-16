// Import Node.js Dependencies
import { EventEmitter } from "node:events";

// Import Third-party Dependencies
import { Channel } from "@myunisoft/redis";
import Ajv, { ValidateFunction } from "ajv";
import { match } from "ts-pattern";

// Import Internal Dependencies
import { TransactionStore } from "../../store/transaction.class";
import {
  DispatcherChannelMessages,
  DispatcherApprovementMessage,
  EventMessage,
  GenericEvent,
  IncomerChannelMessages,
  IncomerRegistrationMessage
} from "../../../types";
import { NestedValidationFunctions } from "../../../utils";
import * as eventsSchema from "../../../schema/eventManagement/index";
import { DispatcherChannelEvents } from "../dispatcher.class";

// CONSTANTS
const ajv = new Ajv();

const kDispatcherChannelEvents = ["REGISTER", "APPROVEMENT", "ABORT_TAKING_LEAD", "ABORT_TAKING_LEAD_BACK"];

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
): event is AnyIncomerChannelMessage<T> {
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

function isEventMessage<T extends GenericEvent>(
  event: IncomerChannelMessages<T>["IncomerMessages"]
): event is EventMessage<T> {
  return event.name !== "REGISTER";
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

export type ValidationCbFn<T extends GenericEvent> = (event: T) => void;
export type eventsValidationFn<T extends GenericEvent> = Map<string, ValidateFunction<T> | NestedValidationFunctions>;

export interface EventsHandlerOptions<T extends GenericEvent> {
  privateUUID: string;
  dispatcherChannelName: string;
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    validationCbFn?: ValidationCbFn<T>;
  }
}

export class EventsHandler<T extends GenericEvent> extends EventEmitter {
  readonly privateUUID: string;
  readonly dispatcherChannelName: string;

  #eventsValidationFn: eventsValidationFn<T>;
  #validationCbFn: ValidationCbFn<T>;

  constructor(options: EventsHandlerOptions<T>) {
    super();

    Object.assign(this, { ...options });

    this.#eventsValidationFn = options.eventsValidation?.eventsValidationFn ?? new Map();
    this.#validationCbFn = options?.eventsValidation?.validationCbFn;

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
    if (event.redisMetadata.origin === this.privateUUID) {
      return;
    }

    if (channel === this.dispatcherChannelName && isDispatcherChannelMessage(event)) {
      match<DispatcherChannelEvents>({ name: event.name })
        .with({ name: "ABORT_TAKING_LEAD" }, async() => {
          // if (this.isWorking) {
          //   this.updateState(false);
          //   await this.setAsInactiveDispatcher();
          // }

          // this.emit(abortMessage);
        })
        .with({ name: "ABORT_TAKING_LEAD_BACK" }, async() => {
          // if (this.isWorking) {
          //   this.updateState(false);
          //   await this.setAsInactiveDispatcher();
          // }

          // this.emit(abortMessage);
        })
        .otherwise(async(cbEvent: IncomerRegistrationMessage | DispatcherApprovementMessage) => {
          this.redisMetadataValidation(cbEvent);

          this.dispatcherMessageSchemaValidation(cbEvent);

          // Then do the work
        });
    }
    else if (isIncomerChannelMessage(event)) {
      //
    }
    else {
      throw new Error("Unknown event for the given Channel");
    }
  }

  private redisMetadataValidation(event: AnyDispatcherChannelMessage | AnyIncomerChannelMessage<T>) {
    const { redisMetadata } = event;

    const redisMetadataValidationFn = this.#eventsValidationFn.get("redisMetadata") as ValidateFunction<Record<string, any>>;

    if (!redisMetadataValidationFn(redisMetadata)) {
      throw new Error(
        `Malformed redis metadata: [${[...redisMetadataValidationFn.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
    }
  }

  private dispatcherMessageSchemaValidation(
    event: IncomerRegistrationMessage | DispatcherApprovementMessage
  ): void {
    const { redisMetadata, ...eventRest } = event;

    const eventValidation = this.#eventsValidationFn.get(eventRest.name);

    if (!eventValidation) {
      //
    }
  }

  private IncomerMessageSchemaValidation(
    event: IncomerChannelMessages<T>["IncomerMessages"]
  ): void {
    // if (this.isIncomerChannelMessage(event)) {
    //   if (this.isEventMessage(event)) {
    //     if (this.#validationCbFn) {
    //       return this.#validationCbFn(event);
    //     }

    //     return eventValidation(event);
    //   }
    // }

    // if (!eventValidation && !this.#validationCbFn) {
    //   if (!this.#validationCbFn) {
    //     throw new Error(`Unknown Event ${eventRest.name}`);
    //   }

    //   if (this.isIncomerChannelMessage(event)) {
    //     return this.#validationCbFn(eventRest as EventMessage<T>);
    //   }
    // }
  }
}
