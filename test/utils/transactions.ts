// Import Internals Dependencies
import {
  type DispatcherSpreadTransaction,
  type IncomerMainTransaction,
  type PartialTransaction,
  TransactionStore
} from "../../src/class/store/transaction.class.js";
import type {
  GenericEvent,
  RegisteredIncomer
} from "../../src/types";

export type GenericOptions = {
  publisher: {
    transactionStore: TransactionStore<"incomer">;
    instance: RegisteredIncomer
  };
  dispatcher: {
    transactionStore: TransactionStore<"dispatcher">;
    instance: RegisteredIncomer
  };
  event: GenericEvent;
  listener?: {
    transactionStore: TransactionStore<"incomer">;
    instance: RegisteredIncomer
  };
}

export async function createResolvedTransactions(options: GenericOptions) {
  const { publisher, dispatcher, event } = options;
  const listener = options.listener ?? Object.assign({}, options.listener, { name: "bar" });

  const mainTransactionPayload: PartialTransaction<"incomer"> = {
    ...event,
    redisMetadata: {
      origin: publisher.instance.providedUUID,
      incomerName: publisher.instance.name,
      published: true,
      relatedTransaction: null,
      mainTransaction: true,
      resolved: true
    }
  };

  const mainTransaction = await publisher.transactionStore.setTransaction(
    mainTransactionPayload as IncomerMainTransaction["incomerEventCastTransaction"]
  );

  const spreadTransactionPayload: PartialTransaction<"dispatcher"> = {
    ...event,
    redisMetadata: {
      origin: dispatcher.instance.providedUUID,
      to: listener.instance.providedUUID,
      incomerName: listener.instance.name,
      mainTransaction: false,
      relatedTransaction: mainTransaction.redisMetadata.transactionId!,
      eventTransactionId: mainTransaction.redisMetadata.transactionId!,
      iteration: 0,
      resolved: true
    }
  };

  const spreadTransaction = await dispatcher.transactionStore.setTransaction(
    spreadTransactionPayload as DispatcherSpreadTransaction["dispatcherDistributedEventTransaction"]
  );

  return {
    mainTransaction,
    spreadTransaction
  };
}

export async function createUnresolvedTransactions(options: GenericOptions) {
  const { publisher, dispatcher, event } = options;
  const listener = options.listener ?? Object.assign({}, options.listener, { name: "bar" });

  const mainTransactionPayload: PartialTransaction<"incomer"> = {
    ...event,
    redisMetadata: {
      origin: publisher.instance.providedUUID,
      incomerName: publisher.instance.name,
      published: true,
      relatedTransaction: null,
      mainTransaction: true,
      resolved: false
    }
  };

  const mainTransaction = await publisher.transactionStore.setTransaction(
    mainTransactionPayload as IncomerMainTransaction["incomerEventCastTransaction"]
  );

  const spreadTransactionPayload: PartialTransaction<"dispatcher"> = {
    ...event,
    redisMetadata: {
      origin: dispatcher.instance.providedUUID,
      to: listener.instance.providedUUID,
      incomerName: listener.instance.name,
      mainTransaction: false,
      relatedTransaction: mainTransaction.redisMetadata.transactionId!,
      eventTransactionId: mainTransaction.redisMetadata.transactionId!,
      iteration: 0,
      resolved: false
    }
  };

  const spreadTransaction = await dispatcher.transactionStore.setTransaction(
    spreadTransactionPayload as DispatcherSpreadTransaction["dispatcherDistributedEventTransaction"]
  );

  return {
    mainTransaction,
    spreadTransaction
  };
}

export async function createUndistributedTransactions(options: GenericOptions) {
  const { publisher, dispatcher, event } = options;
  const listener = options.listener ?? Object.assign({}, options.listener, { name: "bar" });

  const mainTransactionPayload: PartialTransaction<"incomer"> = {
    ...event,
    redisMetadata: {
      origin: publisher.instance.providedUUID,
      incomerName: publisher.instance.name,
      published: true,
      relatedTransaction: null,
      mainTransaction: true,
      resolved: false
    }
  };

  const mainTransaction = await publisher.transactionStore.setTransaction(
    mainTransactionPayload as IncomerMainTransaction["incomerEventCastTransaction"]
  );

  const spreadTransactionPayload: PartialTransaction<"dispatcher"> = {
    ...event,
    redisMetadata: {
      origin: dispatcher.instance.providedUUID,
      to: listener.instance.providedUUID,
      incomerName: listener.instance.name,
      mainTransaction: false,
      relatedTransaction: mainTransaction.redisMetadata.transactionId!,
      eventTransactionId: mainTransaction.redisMetadata.transactionId!,
      iteration: 0,
      resolved: false
    }
  };

  const spreadTransaction = await dispatcher.transactionStore.setTransaction(
    spreadTransactionPayload as DispatcherSpreadTransaction["dispatcherDistributedEventTransaction"]
  );

  return {
    mainTransaction,
    spreadTransaction
  };
}
