<p align="center"><h1 align="center">
  Dispatcher
</h1></p>

<p align="center">
  This class is design as a gateway for events. <br/> 
  Firstly, it ensure that the given events are correctly formatted at run-time (using JSON-Schema). <br/>
  Secondly, it ensure that events are spread & dealed.
</p>

## 📚 Usage

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
<summary><b>eventsValidation</b></summary>

### eventsValidationFn

> Map of Ajv validation functions related to events.

```ts
const eventsValidationFn: MappedEventsValidationFn = new Map<string, CustomEventsValidationFunctions>();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<OperationFunctions>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  eventsValidationFn.set(name, operationsValidationFunctions);
}
```

### validationCbFn

> Callback validation function used to validate events according to the given eventsValidationFn.

```ts
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

### idleTime

> The interval use to determine how many time an instance of an `incomer` can be inactive. <br/>
> ⚠️ Must strictly be greater than the pingInterval options.

</details>


