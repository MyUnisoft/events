// Import Third-party Dependencies
import { Channel, getRedis } from "@myunisoft/redis";

// Import Internal Dependencies
import type {
  DistributedEventMessage,
  GenericEvent,
  IncomerChannelMessages
} from "../../../types/index.js";
import { PartialLogger } from "../dispatcher.class.js";

export interface IncomerChannelHandlerOptions<T extends GenericEvent> {
  logger: PartialLogger;
  channels?: Map<string, Channel<DistributedEventMessage<T>>>;
}

export interface SetChannelOptions {
  uuid: string;
  prefix?: string;
  subscribe?: boolean;
}

export interface RemoveChannelOptions {
  uuid: string;
}

export type ChannelMessages<T extends GenericEvent> = Channel<
  IncomerChannelMessages<T>["DispatcherMessages"]
>;

export class IncomerChannelHandler<T extends GenericEvent = GenericEvent> {
  public channels: Map<string, ChannelMessages<T>> = new Map();

  constructor(opts: IncomerChannelHandlerOptions<T>) {
    Object.assign(this, opts);
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public set(options: SetChannelOptions) {
    const { uuid, prefix } = options;

    const channel = new Channel({
      name: uuid,
      prefix
    });

    this.channels.set(uuid, channel);

    return channel;
  }

  public get(uuid: string): ChannelMessages<T> | null {
    return this.channels.get(uuid);
  }

  public async remove(uuid: string): Promise<void> {
    const channel = this.channels.get(uuid);

    if (!channel) {
      return;
    }

    await this.subscriber.unsubscribe(uuid);

    this.channels.delete(uuid);
  }
}
