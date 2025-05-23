<p align="center"><h1 align="center">
  Events Service
</h1></p>

<p align="center">
  This class is design as a service to retrieve & monitor events.
</p>


## 📚 Usage

> The class can only be used through your Dispatcher instance

```ts
await initRedis();
await initRedis({}, "subscriber");

const dispatcher = new Dispatcher();

await dispatcher.initialize();

await dispatcher.close();
```

## Types

```ts
export interface EventsServiceOptions {
  redis: RedisAdapter;
  incomerStore: IncomerStore;
  dispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupIncomerTransactionStore: TransactionStore<"incomer">;
  idleTime: number;
}

interface GetEventSharedOptions {
  incomerId: string;
}

export type GetEventByIdOptions = GetEventSharedOptions & {
  eventId: string;
};

export type GetIncomerReceivedEventsOptions = GetEventSharedOptions;

export type GetSentEventByIdResponse = Omit<Transaction<"incomer">, "redisMetadata"> & {
  redisMetadata: {
    published: boolean;
    resolved: boolean;
  },
  relatedTransactions: Transaction<"dispatcher">[];
};

export type GetIncomerReceivedEventsResponse = Omit<Transaction<"incomer">, "redisMetadata"> & {
  redisMetadata: {
    eventTransactionId: string;
    resolved: boolean;
  };
};

export interface RegisteredIncomer {
  providedUUID: string;
  baseUUID: string;
  name: string;
  isDispatcherActiveInstance: string;
  lastActivity: number;
  aliveSince: number;
  eventsCast: string[];
  eventsSubscribe: EventSubscribe[];
}
```

## 📜 API

### getIncomers(): Promise< Set < RegisteredIncomer > >

> This method is used to fetch all known incomers.

```ts
const incomers = await dispatcher.eventsService.getIncomers();
```

---

### forceDispatcherTakeLead(incomers: Set < RegisteredIncomer >, dispatcherToRemove: RegisteredIncomer)

> This method emit a signal to the differents Dispatchers in order to abort the current operation of take lead back and then for the current dispatcher to take the lead & remove the given idle instance.

```ts
const incomers = await dispatcher.eventsService.getIncomers();

const isLead = [...incomers.values()].find((incomer) => incomer.isDispatcherActiveInstance === "true");

dispatcher.eventsService.forceDispatcherTakeLead(incomers, isLead);
```

---

### getEventById(opts: GetEventByIdOptions): Promise < GetSentEventByIdResponse >

> This method return data relative for a given published event by an incomer and the transactions related to his distribution.

```ts
const incomer = new Incomer({
  redis,
  subscriber,
  name: "foo",
  eventsCast: [...Object.keys(AVAILABLE_EVENTS)],
  eventsSubscribe: [...Object.values(AVAILABLE_EVENTS)],
  eventCallback: eventCallBackHandler,
  dispatcherInactivityOptions: {
    publishInterval: kPingInterval,
    maxPingInterval: kPingInterval
  },
  externalsInitialized: true
});

await incomer.initialize();

const eventId = await secondIncomer.publish({
  name: "connector",
  scope: {
    schemaId: 1
  },
  operation: "CREATE",
  data: {
    id: "1",
    code: "foo"
  },
  metadata: {
    agent: "nodejs",
    origin: {
      endpoint: "test",
      method: "POST"
    },
    createdAt: Date.now()
  }
});

const eventData = await dispatcher.eventsService.getEventById({ incomerId: incomer.providedUUID, eventId });
```

---

### getIncomerReceivedEvents(opts: GetIncomerReceivedEventsOptions): Promise < GetIncomerReceivedEventsResponse[] >

> This method returns data about the received events and their origin.

```ts
const incomer = new Incomer({
  redis,
  subscriber,
  name: "foo",
  eventsCast: [...Object.keys(AVAILABLE_EVENTS)],
  eventsSubscribe: [...Object.values(AVAILABLE_EVENTS)],
  eventCallback: eventCallBackHandler,
  dispatcherInactivityOptions: {
    publishInterval: kPingInterval,
    maxPingInterval: kPingInterval
  },
  externalsInitialized: true
});

await incomer.initialize();

const eventsData = await dispatcher.eventsService.getIncomerReceivedEvents({ incomerId: incomer.providedUUID });
```
