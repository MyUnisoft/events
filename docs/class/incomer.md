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

type GenericEvent = Record<string, any> & { data: Record<string, any> };

type EventCast<T extends string | keyof Events = string> = T;

type EventSubscribe<T extends string | keyof Events = string> = {
  name: T;
  delay?: number;
  horizontalScale?: boolean;
};

type CallBackEventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  name: string;
};

type EventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  name: string;
  redisMetadata: IncomerTransactionMetadata;
};

type IncomerOptions<T extends GenericEvent = GenericEvent> = {
  /* Service name */
  name: string;
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn">;
  standardLog?: StandardLog<T>;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  eventCallback: (message: CallBackEventMessage<T>) => Promise<EventCallbackResponse>;
  prefix?: Prefix;
  abortPublishTime?: number;
  externalsInitialized?: boolean;
};
```


## Options

<details> 
<summary><b>logger</b></summary>
<br/>

> Default logger is a pino logger. <br/>
> ⚠️ You can inject your own but you must ensure that the provided logger has those methods `info` | `error` | `warn`.

</details>

---

<details> 
<summary><b>standardLog</b></summary>
<br/>

> Callback function use to formate logs related to custom events casting.

```ts
function standardLog<T extends GenericEvent = EventOptions<keyof Events>>
(event: T & { redisMetadata: { transactionId: string } }) {
  const logs = `foo: ${event.foo}`;

  function log(message: string) {
    return `(${logs}) ${message}`;
  }

  return log;
}
```

</details>

---

<details> 
<summary><b>abortPublishTime</b></summary>
<br/>

> Interval of time during which the `incomer` instance is going to wait to for a response from the `dispatcher` next to the registration demand or any event publishing. <br/>
> If there is no recent activity from the `dispatcher`, those events are not publish and saved in Redis awaiting for the next iteration.

</details>

---

<details> 
<summary><b>externalsInitialized</b></summary>
<br/>

> Use to initialize `externals` class. As `false` and with a `prefix` with the value `test` or `development`, it will init a `dispatcher` and an `incomer` in order to run tests without any other accessible APIs.

</details>

## API

### publish< K extends GenericEvent | null = null >(event: K extends null ? Omit< EventMessage< T >, "redisMetadata" >): Promise<void>

> Publish the given event on Redis pubsub. <br/>
> If there is no dispatcher alive, the event isn't publish but saved in Redis awaiting for an incoming publish.
