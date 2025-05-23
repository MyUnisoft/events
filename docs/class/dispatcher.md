<p align="center"><h1 align="center">
  Dispatcher
</h1></p>

<p align="center">
  This class is design as a gateway for events. <br/> 
  Firstly, it ensure that the given events are correctly formatted at run-time (using JSON-Schema). <br/>
  Secondly, it ensure that events are spread & dealed.
</p>

## 📚 Usage

> [!TIP]
> If you want to monitor your events,  
> you can follow the [Events Service documentation](./events.service.md)

```ts
await initRedis();
await initRedis({}, "subscriber");

const dispatcher = new Dispatcher();

await dispatcher.initialize();

await dispatcher.close();
```

## Types

```ts
type Prefix = "test" | "development" | "staging" | "production";

type GenericEvent = Record<string, any> & { data: Record<string, any> };

type DispatcherOptions<T extends GenericEvent = GenericEvent> = {
  /* Prefix for the channel name, commonly used to distinguish envs */
  prefix?: Prefix;
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn">;
  standardLog?: StandardLog<T>;
  eventsValidation?: {
    eventsValidationFn?: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>;
    validationCbFn?: (event: T) => void;
  },
  pingInterval?: number;
  checkLastActivityInterval?: number;
  checkTransactionInterval?: number;
  idleTime?: number;
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
<summary><b>eventsValidation</b></summary>

### eventsValidationFn

> Map of Ajv validation functions related to events.

```ts
type NestedValidationFunctions = Map<string, ValidateFunction<Record<string, any>>>;

type eventsValidationFn<T extends GenericEvent> = Map<string, ValidateFunction<T> | NestedValidationFunctions>;

export const eventsValidationFn: MappedEventsValidationFn = new Map<string, NestedValidationFunctions>();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<Record<string, any>>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  eventsValidationFn.set(name, operationsValidationFunctions);
}
```

### validationCbFn

> Callback validation function used to validate events according to the given eventsValidationFn.

```ts
type customValidationCbFn<T extends GenericEvent> = (event: T) => void;

function validate<T extends keyof Events = keyof Events>(options: EventOptions<T>) {
  const { name, operation, data, scope, metadata } = options;

  if (!eventsValidationFn.has(name)) {
    throw new Error(`Unknown "event": ${name}`);
  }

  const event = eventsValidationFn.get(name);
  if (!event.has(operation.toLocaleLowerCase())) {
    throw new Error(`Unknown "operation": ${operation} for the "event": ${name}`);
  }

  const operationValidationFunction = event.get(operation.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw new Error(`"event": ${name} | "operation": ${operation}: ${[...operationValidationFunction.errors]
      .map((error) => error.message)}`);
  }

  if (!metadataValidationFunction(metadata)) {
    throw new Error(`metadata: ${[...metadataValidationFunction.errors].map((error) => error.message)}`);
  }

  if (!scopeValidationFunction(scope)) {
    throw new Error(`scope: ${[...scopeValidationFunction.errors].map((error) => error.message)}`);
  }
}
```

</details>

---

<details> 
<summary><b>Intervals</b></summary>

### pingInterval

> The interval use to ping known instances of `incomer`. <br/>
> ⚠️ Must strictly be smaller than the idleTime options.

### checkLastActivityInterval

> The interval use to check on known instances of `incomer` state. <br/>
> If those have no recent lastActivity, they are evicted.

### checkTransactionInterval

> The interval use to check on `transactions` state. <br/>
> When a transaction related to an event is resolved, his state is update. According to this state, we can define if an event has been dealed through all related instances of `incomer`.

### checkDispatcherStateInterval

> Interval based on the pingInterval that is use to check on others Dispatcher state <br/>
> If the Dispatcher that's lead is idle, dispatchers check to take the lead back on the idle instance.

</details>


