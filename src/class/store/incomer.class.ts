// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  KVOptions,
  KVPeer
} from "@myunisoft/redis";

// Import Internal Dependencies
import { EventCast, EventSubscribe } from "../../types";

export interface RegisteredIncomer {
  providedUUID: string;
  baseUUID: string;
  name: string;
  isDispatcherActiveInstance: boolean;
  lastActivity: number;
  aliveSince: number;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  prefix?: string;
}

export class IncomerStore extends KVPeer<RegisteredIncomer> {
  private key: string;

  constructor(options: Partial<KVOptions<RegisteredIncomer>>) {
    super({ ...options, prefix: undefined, type: "object" });

    this.key = `${options.prefix ? `${options.prefix}-` : ""}incomer`;
  }

  async setIncomer(incomer: Omit<RegisteredIncomer, "providedUUID">): Promise<string> {
    const providedUUID = randomUUID();

    const key = `${this.key}-${providedUUID}`;

    await this.setValue({ key,
      value: {
        ...incomer,
        providedUUID
      }
    });

    return providedUUID;
  }

  async* incomerLazyFetch() {
    const count = 5000;
    let cursor = 0;

    do {
      const [lastCursor, incomerKeys] = await this.redis.scan(cursor, "MATCH", `${this.key}-*`, "COUNT", count);

      cursor = Number(lastCursor);

      yield incomerKeys;

      continue;
    }
    while (cursor !== 0);
  }

  async getIncomers(): Promise<Set<RegisteredIncomer>> {
    const incomers: Set<RegisteredIncomer> = new Set();

    for await (const incomerKeys of this.incomerLazyFetch()) {
      const foundIncomers = await Promise.all(incomerKeys.map(
        (incomerKey) => this.getValue(incomerKey)
      ));

      for (const incomer of foundIncomers) {
        incomers.add(incomer);
      }
    }

    return incomers;
  }

  async updateIncomer(incomer: RegisteredIncomer) {
    const incomerKey = `${this.key}-${incomer.providedUUID}`;

    await this.setValue({ key: incomerKey, value: { ...incomer, lastActivity: Date.now() } });
  }

  async updateIncomerState(incomerId: string): Promise<void> {
    const incomerKey = `${this.key}-${incomerId}`;
    const incomer = await this.getValue(incomerKey);

    if (!incomer) {
      throw new Error("Cannot find the Incomer");
    }

    this.setValue({ key: incomerKey, value: { ...incomer, lastActivity: Date.now() } });
  }

  async deleteIncomer(incomerId: string): Promise<void> {
    await this.deleteValue(`${this.key}-${incomerId}`);
  }
}
