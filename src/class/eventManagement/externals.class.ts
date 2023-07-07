// Import Internal Dependencies
import { Incomer, IncomerOptions } from "./incomer.class";
import { Dispatcher } from "./dispatcher.class";
import {
  EventOptions,
  Events
} from "../../types";
import {
  AVAILABLE_EVENTS,
  eventsValidationFn,
  validate
} from "../../index";

export class Externals<T extends EventOptions<keyof Events> = EventOptions<keyof Events>> {
  private incomer: Incomer<T>;
  private dispatcher: Dispatcher<T>;

  constructor(options: IncomerOptions<T>) {
    this.incomer = new Incomer({
      ...options,
      eventsCast: options.eventsSubscribe.map((val) => val.name),
      eventsSubscribe: Object.values(AVAILABLE_EVENTS).filter(
        (event) => options.eventsCast.find((eventCast) => eventCast === event.name)
      )
    });

    this.dispatcher = new Dispatcher({
      ...options,
      pingInterval: Number(process.env.MYUNISOFT_DISPATCHER_PING) || undefined,
      checkLastActivityInterval: Number(process.env.MYUNISOFT_DISPATCHER_ACTIVITY_CHECK) || undefined,
      checkTransactionInterval: Number(process.env.MYUNISOFT_DISPATCHER_TRANSACTION_CHECK) || undefined,
      idleTime: Number(process.env.MYUNISOFT_IDLE_TIME) || undefined,
      eventsValidation: {
        eventsValidationFn,
        validationCbFn: validate
      }
    });
  }

  public async initialize() {
    await this.dispatcher.initialize();
    await this.incomer.initialize();
  }

  public async close() {
    await this.dispatcher.close();
  }
}
