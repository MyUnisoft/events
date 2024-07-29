<p align="center"><h1 align="center">
  Incomer
</h1></p>

<p align="center">
  This class is design as a client for events. <br/> 
  It ensure that events are sended to the <b>Dispatcher</b> or save in the Redis, <br/>
  and execute the provided <b>eventCallback</b> when a event concern this client.
</p>

## 📚 Usage

```ts
await initRedis();
await initRedis({}, "subscriber");

const AVAILABLE_EVENTS = Object.freeze<Record<keyof Events, EventSubscribe>>(
  ([...eventsValidationFn.keys()].map((name) => {
    return {
      name,
      delay: undefined,
      horizontalScale: undefined
    };
  })).reduce((prev, curr) => Object.assign(prev, { [curr.name]: curr }), {}) as Record<keyof Events, EventSubscribe>
);

const incomer = new Incomer({
  name: "foo",
  eventsCast: [...Object.keys(AVAILABLE_EVENTS)],
  eventsSubscribe: [...Object.values(AVAILABLE_EVENTS)],
  eventCallback: (event) => {
    console.log(event);

    return OK({ status: "RESOLVED" });
  }
});

await incomer.initialize();

await incomer.close();
```

## Types

```ts
type Prefix = "test" | "development" | "staging" | "production";

type GenericEvent = {
  name: string;
  data: Record<string, any>;
  [key: string]: any;
};


type EventCast<T extends string | keyof Events = string> = T;

type EventSubscribe<T extends string | keyof Events = string> = {
  name: T;
  delay?: number;
  horizontalScale?: boolean;
};

type CallBackEventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  eventTransactionId: string;
};

export type Resolved = "RESOLVED";
export type Unresolved = "UNRESOLVED";

type EventCallbackResponse<T extends Resolved | Unresolved = Resolved | Unresolved> = Result<
  T extends Resolved ? {
    status: T;
  } : {
  status: T;
  retryStrategy?: {
    maxIteration: number;
  };
  reason: string;
}, string>;

type NestedValidationFunctions = Map<string, ValidateFunction<Record<string, any>>>;

type customValidationCbFn<T extends GenericEvent> = (event: T) => void;
type eventsValidationFn<T extends GenericEvent> = Map<string, ValidateFunction<T> | NestedValidationFunctions>;

type IncomerOptions<T extends GenericEvent = GenericEvent> = {
  /* Service name */
  name: string;
  prefix?: Prefix;
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn">;
  standardLog?: StandardLog<T>;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    customValidationCbFn?: customValidationCbFn<T>;
  };
  eventCallback: (message: CallBackEventMessage<T>) => Promise<EventCallbackResponse>;
  dispatcherInactivityOptions?: {
    /* max interval between received ping before considering dispatcher off */
    maxPingInterval?: number;
    /* max interval between a new event (based on ping interval) */
    publishInterval?: number;
  };
  isDispatcherInstance?: boolean;
  externalsInitialized?: boolean;
};
```


## Options

<details> 
<summary><b>logger</b></summary>
<br/>

> Default logger is a pino logger. <br/>
> ⚠️ You can inject your own but you must ensure that the provided logger has those methods `info` | `error` | `warn` | `debug`.

</details>

---

<details> 
<summary><b>standardLog</b></summary>
<br/>

> Callback function use to formate logs related to custom events casting.

```ts
type StandardLogOpts<T extends GenericEvent = GenericEvent> = T & {
  redisMetadata: {
    transactionId: string;
    origin?: string;
    to?: string;
    eventTransactionId?: string;
  }
};
```

> Default Callback function used.

```ts
function logValueFallback(value: string): string {
  return value ?? "none";
}

function standardLog<T extends GenericEvent = EventOptions<keyof Events>>
(data: StandardLogOpts<T>) {
  const logs = Array.from(mapped<T>(event)).join("|");

  // eslint-disable-next-line max-len
  const eventMeta = `name:${logValueFallback(event.name)}|ope:${logValueFallback(event.operation)}|from:${logValueFallback(event.redisMetadata.origin)}|to:${logValueFallback(event.redisMetadata.to)}`;

  function log(message: string) {
    return `(${logs})(${eventMeta}) ${message}`;
  }

  return log;
}
```

</details>

---

<details> 
<summary><b>externalsInitialized</b></summary>
<br/>

> Use to initialize `externals` class. As `false` and with a `prefix` with the value `test` or `development`, it will init a `dispatcher` and an `incomer` in order to run tests without any other accessible APIs.

</details>

## API

### publish(event: T): Promise<void>

> Publish the given event on Redis pubsub. <br/>
> If there is no dispatcher alive, the event isn't publish but saved in Redis awaiting for an incoming publish.
