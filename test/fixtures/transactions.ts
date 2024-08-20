// Import Internals Dependencies
import { DispatcherSpreadTransaction, IncomerHandlerTransaction, IncomerMainTransaction, PartialTransaction, TransactionStore } from "../../src/class/store/transaction.class";
import { GenericEvent, RegisteredIncomer } from "../../src/types";

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
      incomerName: "dispatcher",
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

  const handlerTransactionPayload: PartialTransaction<"incomer"> = {
    ...event,
    redisMetadata: {
      origin: dispatcher.instance.providedUUID,
      to: listener.instance.providedUUID,
      incomerName: listener.instance.name,
      mainTransaction: false,
      resolved: true,
      relatedTransaction: spreadTransaction.redisMetadata.transactionId,
      eventTransactionId: mainTransaction.redisMetadata.transactionId!,
    }
  }

  const handlerTransaction = await listener.transactionStore.setTransaction(
    handlerTransactionPayload as IncomerHandlerTransaction["incomerDistributedEventTransaction"]
  );

  return {
    mainTransaction,
    spreadTransaction,
    handlerTransaction
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
      incomerName: "dispatcher",
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

  const handlerTransactionPayload: PartialTransaction<"incomer"> = {
    ...event,
    redisMetadata: {
      origin: dispatcher.instance.providedUUID,
      to: listener.instance.providedUUID,
      incomerName: listener.instance.name,
      mainTransaction: false,
      resolved: false,
      relatedTransaction: spreadTransaction.redisMetadata.transactionId,
      eventTransactionId: mainTransaction.redisMetadata.transactionId!,
    }
  }

  const handlerTransaction = await listener.transactionStore.setTransaction(
    handlerTransactionPayload as IncomerHandlerTransaction["incomerDistributedEventTransaction"]
  );

  return {
    mainTransaction,
    spreadTransaction,
    handlerTransaction
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
      incomerName: "dispatcher",
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
