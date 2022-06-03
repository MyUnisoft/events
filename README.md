<p align="center"><h1 align="center">
  Events
</h1>

<p align="center">
  MyUnisoft Events validator, schemas and types (useful to work with Webhooks).
</p>

<p align="center">
    <a href="https://github.com/MyUnisoft/events"><img src="https://img.shields.io/github/package-json/v/MyUnisoft/events?style=flat-square" alt="npm version"></a>
    <a href="https://github.com/MyUnisoft/events"><img src="https://img.shields.io/github/license/MyUnisoft/events?style=flat-square" alt="license"></a>
    <a href="https://github.com/MyUnisoft/events"><img src="https://img.shields.io/github/languages/code-size/MyUnisoft/events?style=flat-square" alt="size"></a>
    <a href="./SECURITY.md"><img src="https://img.shields.io/badge/Security-Responsible%20Disclosure-yellow.svg?style=flat-square" alt="Responsible Disclosure Policy" /></a>
</p>

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

## API

### validateEventData< T extends keyof EventsDefinition.Events >(options: EventsDefinition.Events[ T ]): void
Throw an error if a given event is not internaly known.

## Types

<details><summary>EventOptions</summary>

```ts
export type EventOptions<K extends keyof EventsDefinition.Events> = {
  scope: Scope;
  metadata: Metadata;
} & EventsDefinition.Events[K];

const event: EventOptions<"connector"> = {
  name: "connector",
  operation: "CREATE",
  scope: {
    schemaId: 1
  },
  metadata: {
    agent: "Node",
    createdAt: Date.now().toLocaleString()
  },
  data: {
    connectorId: 1
  }
}
```

</details>

<details><summary>EventOptions</summary>

```ts
type TupleToObject<T extends readonly any[],
  M extends Record<Exclude<keyof T, keyof any[]>, PropertyKey>> =
  { [K in Exclude<keyof T, keyof any[]> as M[K]]: T[K] };

export type EventsOptions<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = TupleToObject<[
  ...(EventOptions<T[number]>)[]
], []>;

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

const event: EventsOptions<["connector", "accountingFolder"]> = {
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
</details>

<details><summary>WebhooksResponse</summary>

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
</details>

## Contributors ✨

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-2-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://www.linkedin.com/in/nicolas-hallaert/"><img src="https://avatars.githubusercontent.com/u/39910164?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Nicolas Hallaert</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Documentation">📖</a> <a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Tests">⚠️</a></td>
    <td align="center"><a href="http://sofiand.github.io/portfolio-client/"><img src="https://avatars.githubusercontent.com/u/39944043?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Yefis</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=SofianD" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=SofianD" title="Documentation">📖</a></td>
  </tr>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License
MIT
