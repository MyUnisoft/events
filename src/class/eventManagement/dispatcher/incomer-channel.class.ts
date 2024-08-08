// Import Third-party Dependencies
import { Channel, getRedis } from "@myunisoft/redis";
import type { Logger } from "pino";

// Import Internal Dependencies
import type {
  DistributedEventMessage,
  GenericEvent,
  IncomerChannelMessages
} from "../../../types/index.js";

export interface IncomerChannelHandlerOptions<T extends GenericEvent> {
  logger: Logger;
  channels?: Map<string, Channel<DistributedEventMessage<T>>>;
}

export interface SetChannelOptions {
  uuid: string;
  prefix?: string;
  subscribe?: boolean;
}

export type ChannelMessages<T extends GenericEvent> = Channel<
  IncomerChannelMessages<T>["DispatcherMessages"]
>;

export class IncomerChannelHandler<
  T extends GenericEvent = GenericEvent
> {
  public channels: Map<string, ChannelMessages<T>> = new Map();

  constructor(
    options: IncomerChannelHandlerOptions<T>
  ) {
    Object.assign(this, options);
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  set(
    options: SetChannelOptions
  ) {
    const { uuid, prefix } = options;

    const channel = new Channel({
      name: uuid,
      prefix
    });

    this.channels.set(uuid, channel);

    return channel;
  }

  get(
    uuid: string
  ): ChannelMessages<T> | null {
    return this.channels.get(uuid);
  }

  async remove(
    uuid: string
  ): Promise<void> {
    if (!this.channels.has(uuid)) {
      return;
    }

    await this.subscriber.unsubscribe(uuid);
    this.channels.delete(uuid);
  }
}
