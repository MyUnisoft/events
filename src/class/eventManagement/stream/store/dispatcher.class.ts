// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  KVOptions,
  KVPeer
} from "@myunisoft/redis";

// Import Internal Dependencies
import { EventCast, EventSubscribe } from "../../../../types";

export interface RegisteredDispatcher {
  providedUUID: string;
  baseUUID: string;
  name: string;
  isActiveInstance: boolean;
  lastActivity: number;
  aliveSince: number;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  prefix?: string;
}

export class DispatcherStore extends KVPeer<RegisteredDispatcher> {
  private key: string;

  constructor(options: Partial<KVOptions<RegisteredDispatcher>>) {
    super({ ...options, prefix: undefined, type: "object" });

    this.key = `${options.prefix ? `${options.prefix}-` : ""}dispatcher`;
  }

  async set(dispatcher: RegisteredDispatcher): Promise<void> {
    const key = `${this.key}-${dispatcher.providedUUID}`;

    await this.setValue({ key, value: dispatcher });
  }

  async* lazyFetch() {
    const count = 5000;
    let cursor = 0;

    do {
      const [lastCursor, dispatcherKeys] = await this.redis.scan(
        cursor,
        "MATCH", `${this.key}-*`,
        "COUNT", count,
        "TYPE", "hash"
      );

      cursor = Number(lastCursor);

      yield dispatcherKeys;

      continue;
    }
    while (cursor !== 0);
  }

  async getAll(): Promise<Set<RegisteredDispatcher>> {
    const dispatchers: Set<RegisteredDispatcher> = new Set();

    for await (const dispatcherKeys of this.lazyFetch()) {
      const fetchedDispatchers = await Promise.all(dispatcherKeys.map(
        (dispatcherKey) => this.getValue(dispatcherKey)
      ));

      for (const dispatcher of fetchedDispatchers) {
        dispatchers.add(dispatcher);
      }
    }

    return dispatchers;
  }

  async getByUUID(uuid: string): Promise<RegisteredDispatcher> {
    return await this.getValue(`${this.key}-${uuid}`);
  }

  async update(dispatcher: RegisteredDispatcher) {
    const dispatcherKey = `${this.key}-${dispatcher.providedUUID}`;

    await this.setValue({
      key: dispatcherKey,
      value: { ...dispatcher, lastActivity: Date.now() }
    });
  }

  async updateState(uuid: string): Promise<void> {
    const dispatcherKey = `${this.key}-${uuid}`;
    const dispatcher = await this.getValue(dispatcherKey);

    if (!dispatcher) {
      throw new Error("Cannot find the Incomer");
    }

    this.setValue({
      key: dispatcherKey,
      value: { ...dispatcher, lastActivity: Date.now() }
    });
  }

  async delete(uuid: string): Promise<void> {
    await this.deleteValue(`${this.key}-${uuid}`);
  }
}
