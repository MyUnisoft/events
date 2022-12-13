// Import Third-party Dependencies
import {
  KVOptions,
  KVPeer,
  Redis,
  SetValueOptions
} from "@myunisoft/redis-utils";

// Import Internal Dependencies
import { Transaction } from "types/utils";

export type Transactions = Record<string, Transaction>;

export type Instance = "dispatcher" | "incomer";

export type TransactionStoreOptions = {
  instance: Instance
} & Partial<KVOptions<Transactions>>;

export class TransactionStore extends KVPeer<Transactions> {
  private key: string;

  constructor(options: TransactionStoreOptions, redis?: Redis) {
    super({ ...options, prefix: undefined, type: "object" }, redis);

    this.key = `${options.prefix ? `${options.prefix}-` : ""}${options.instance}-transaction`;
  }

  async setValue(options: Omit<SetValueOptions<Transactions>, "key">): Promise<string | Buffer> {
    const key = this.key;

    return await super.setValue({ ...options, key });
  }

  async getValue(): Promise<Transactions & { metadata: null } | null> {
    return await super.getValue(this.key);
  }

  async deleteValue() {
    return await super.deleteValue(this.key);
  }
}
