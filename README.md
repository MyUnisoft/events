# Events
MyUnisoft Events data validation, and transparency on events & result of webhooks.

## Requirements
- [Node.js](https://nodejs.org/en/) version 14 or higher

## Getting Started

This package is available in the Node Package Repository and can be easily installed with [npm](https://doc.npmjs.com/getting-started/what-is-npm) or [yarn](https://yarnpkg.com)

```bash
$ npm i @myunisoft/events
# or
$ yarn add @myunisoft/events
```

## Usage

- [Events descriptions](./docs/events.md)

### validateEventData

```ts
import { EventsDefinition, validateEventData } from "@myunisoft/events";

const event: EventsDefinition.AccountingFolder = {
  name: "accountingFolder",
  operation: "CREATE",
  data: {
    accountingFolderId: 1
  }
};

validateEventData<"connector" | "accountingFolder">(event);
```

## Types

### EventOptions

```ts
export type EventOptions<K extends keyof EventsDefinition.Events> = {
  scope: Scope;
  metadata: Metadata;
} & EventsDefinition.Events[K];

const event: EventOptions<"connector"> = {
  name: "connector",
  operation: "CREATE",
  data: {
    connectorId: 1
  },
  scope: {
    schemaId: 1
  },
  metadata: {
    agent: "Node",
    createdAt: Date.now().toLocaleString()
  }
}
```

### EventsOptions

```ts
export type EventsOptions<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = [
  ...(EventOptions<T[number]>)[]
];

const events: EventsOptions<["connector", "accountingFolder"]> = [
  {
    name: "connector",
    operation: "CREATE",
    data: {
      connectorId: 1
    },
    scope: {
      schemaId: 1
    },
    metadata: {
      agent: "Node",
      createdAt: Date.now().toLocaleString()
    }
  },
  {
    name: "accountingFolder",
    operation: "CREATE",
    data: {
      accountingFolderId: 1
    },
    scope: {
      schemaId: 1
    },
    metadata: {
      agent: "Windev",
      createdAt: Date.now().toLocaleString()
    }
  }
];
```

### WebhooksResponse

```ts
type WebhookResponse<K extends keyof EventsDefinition.Events> = {
  scope: Scope;
  webhookId: string;
  createdAt: number;
} & EventsDefinition.Events[K];

export type WebhooksResponse<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

const response: WebhooksResponse<["connector", "accountingFolder"]> = [
  {
    name: "connector",
    operation: "CREATE",
    data: {
      connectorId: 1
    },
    scope: {
      schemaId: 1
    },
    webhookId: 1,
    createdAt: Date.now().toLocaleString()
  },
  {
    name: "accountingFolder",
    operation: "CREATE",
    data: {
      accountingFolderId: 1
    },
    scope: {
      schemaId: 1
    },
    webhookId: 2,
    createdAt: Date.now().toLocaleString()
  },
];
```
