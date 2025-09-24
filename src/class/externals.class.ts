// Import Internal Dependencies
import { EventCallbackResponse, Incomer, type IncomerOptions } from "./incomer.class.js";
import { Dispatcher } from "./dispatcher.class.js";
import type {
  CallBackEventMessage,
  GenericEvent
} from "../types/index.js";

export class Externals<
  TListenedEvents extends GenericEvent = GenericEvent,
  KCastedEvents extends GenericEvent = GenericEvent
> {
  public incomer: Incomer<KCastedEvents, TListenedEvents>;
  public dispatcher: Dispatcher<TListenedEvents | KCastedEvents>;

  constructor(
    options: IncomerOptions<TListenedEvents, KCastedEvents>
  ) {
    const opts: IncomerOptions<KCastedEvents, TListenedEvents> = {
      ...options,
      eventCallback: options.eventCallback as unknown as (
        message: CallBackEventMessage<KCastedEvents>
      ) => Promise<EventCallbackResponse>,
      eventsCast: options.eventsSubscribe.map((val) => val.name),
      eventsSubscribe: options.eventsCast.map((eventCast) => {
        return {
          name: eventCast
        };
      }),
      externalsInitialized: true
    };
    this.incomer = new Incomer<KCastedEvents, TListenedEvents>(opts);

    this.dispatcher = new Dispatcher<TListenedEvents | KCastedEvents>({
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
