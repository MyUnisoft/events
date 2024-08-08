// Import Internal Dependencies
import { Incomer, type IncomerOptions } from "./incomer.class.js";
import { Dispatcher } from "./dispatcher.class.js";
import type {
  GenericEvent
} from "../../types/index.js";

export class Externals<T extends GenericEvent = GenericEvent> {
  public incomer: Incomer<T>;
  public dispatcher: Dispatcher<T>;

  constructor(
    options: IncomerOptions<T>
  ) {
    this.incomer = new Incomer({
      ...options,
      eventsCast: options.eventsSubscribe.map((val) => val.name),
      eventsSubscribe: options.eventsCast.map((eventCast) => {
        return {
          name: eventCast
        };
      }),
      externalsInitialized: true
    });

    this.dispatcher = new Dispatcher({
      name: "pulsar",
      ...options,
      pingInterval: Number(process.env.MYUNISOFT_DISPATCHER_PING) || undefined,
      checkLastActivityInterval: Number(process.env.MYUNISOFT_DISPATCHER_ACTIVITY_CHECK) || undefined,
      checkTransactionInterval: Number(process.env.MYUNISOFT_DISPATCHER_TRANSACTION_CHECK) || undefined,
      idleTime: Number(process.env.MYUNISOFT_IDLE_TIME) || undefined
    });
  }

  public async initialize() {
    await this.dispatcher.initialize();
    await this.incomer.initialize();
  }

  public async close() {
    await this.dispatcher.close();
    await this.incomer.close();
  }
}
