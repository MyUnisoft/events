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
</p>

## 🚧 Requirements

- [Node.js](https://nodejs.org/en/) version 16 or higher

## 🚀 Getting Started

This package is available in the Node Package Repository and can be easily installed with [npm](https://doc.npmjs.com/getting-started/what-is-npm) or [yarn](https://yarnpkg.com)

```bash
$ npm i @myunisoft/events
# or
$ yarn add @myunisoft/events
```

## 📚 Usage

Define an event with TypeScript and validate it

```ts
import * as MyEvents, { EventOptions } from "@myunisoft/events";

const event: EventOptions<"connector"> = {
  name: "connector",
  operation: "CREATE",
  scope: {
    schemaId: 1
  },
  metadata: {
    agent: "Node",
    origin: {
      endpoint: "http://localhost:12080/api/v1/my-custom-feature",
      method: "POST",
      requestId: crypto.randomUUID();
    },
    createdAt: Date.now()
  },
  data: {
    id: 1,
    code: "JFAC"
  }
};

MyEvents.validate<"connector">(event);
```

> 👀 See [**here**](./example/fastify/feature/webhook.ts) for an example of exploiting webhooks with an http server.

## API

### validate< T extends keyof Events >(options: EventOptions<T>): void
Throw an error if a given event is not internaly known.

## Events

An Event fully constitued is composed by a `name`, an `operation` a multiple objects such as `data`, `scope` and `metadata`.
- The `name` identify the event.
- The `operation` will define if it is a creation, update or deletion.
- According to the name, we know the `data` and the differentes `metadata.origin.method` related.
- The `metadata` object is used to determine differentes informations as the ecosystem, the entry point etc.
- The `scope` will define the **who**.

```ts
export interface Scope {
  schemaId: number;
  firmId?: number;
  accountingFolderId?: number;
  persPhysiqueId?: number;
}

export type Method = "POST" | "PATCH" | "PUT" | "DELETE";

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    method: Method;
    requestId?: string;
  };
  createdAt: number;
}
```

**Below is an exhaustive list of the MyUnisoft Events available**

<details><summary>Connector</summary>

[JSON Schema](./docs/json-schema/events/connector.md)

```ts
export interface Connector {
  name: "connector";
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
    code: string;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | <pre>{ <br/> &emsp; id: string; <br/> &emsp; code: string; <br/>}</pre>  |
| UPDATE  | Node  | <pre>{ <br/> &emsp; id: string; <br/> &emsp; code: string; <br/>}</pre>  |
| DELETE  | Node  | <pre>{ <br/> &emsp; id: string; <br/> &emsp; code: string; <br/>}</pre> |


</details>


<details><summary>AccountingFolder</summary>

[JSON Schema](./docs/json-schema/events/accountingFolder.md)

```ts
export interface AccountingFolder {
  name: "accountingFolder";
  operation: "CREATE";
  data: {
    id: string;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Windev  | <pre>{ <br/> &emsp; id: string; <br/>}</pre>  |

</details>

<details><summary>Document</summary>

[JSON Schema](./docs/json-schema/events/document.md)

```ts
export enum DocumentKind {
  DossierAnnuel = "AF",
  DossierPermanent = "PF",
  BaseDocumentaire = "DB"
}

export interface Document {
  name: "document";
  operation: "CREATE";
  data: {
    id: string;
    kind: DocumentKind;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | <pre>{ <br/> &emsp; id: string; <br/> &emsp; kind: DocumentKind; <br/>}</pre>  |

</details>
<br/>

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
    createdAt: Date.now(),
    requestId: crypto.randomUUID();
  },
  data: {
    id: 1,
    code: "JFAC"
  }
}
```

</details>

<details><summary>EventsOptions</summary>

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
    scope: {
      schemaId: 1
    },
    metadata: {
      agent: "Node",
      createdAt: Date.now(),
      requestId: crypto.randomUUID();
    },
    data: {
      id: 1,
      code: "JFAC"
    }
  },
  {
    name: "accountingFolder",
    operation: "CREATE",
    scope: {
      schemaId: 1
    },
    metadata: {
      agent: "Windev",
      createdAt: Date.now(),
      requestId: crypto.randomUUID();
    },
    data: {
      id: 1
    }
  }
];

const event: EventsOptions<["connector", "accountingFolder"]> = {
  name: "connector",
  operation: "CREATE",
  scope: {
    schemaId: 1
  },
  metadata: {
    agent: "Node",
    createdAt: Date.now(),
    requestId: 0
  },
  data: {
    id: 1,
    code: "JFAC"
  }
}
```
</details>

<details><summary>WebhooksResponse</summary>

```ts
type WebhookResponse<K extends keyof EventTypes.Events> = {
  scope: Scope;
  webhookId: string;
  createdAt: number;
} & EventTypes.Events[K];

export type WebhooksResponse<T extends (keyof EventTypes.Events)[] = (keyof EventTypes.Events)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

const response: WebhooksResponse<["connector", "accountingFolder"]> = [
  {
    name: "connector",
    operation: "CREATE",
    scope: {
      schemaId: 1
    },
    data: {
      id: 1,
      code: "JFAC"
    },
    webhookId: 1,
    createdAt: Date.now()
  },
  {
    name: "accountingFolder",
    operation: "CREATE",
    scope: {
      schemaId: 1
    },
    data: {
      id: 1
    },
    webhookId: 2,
    createdAt: Date.now()
  },
];
```
</details>

<br/>

## Contributors ✨

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-3-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://www.linkedin.com/in/nicolas-hallaert/"><img src="https://avatars.githubusercontent.com/u/39910164?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Nicolas Hallaert</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Documentation">📖</a> <a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Tests">⚠️</a></td>
    <td align="center"><a href="http://sofiand.github.io/portfolio-client/"><img src="https://avatars.githubusercontent.com/u/39944043?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Yefis</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=SofianD" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=SofianD" title="Documentation">📖</a></td>
    <td align="center"><a href="https://www.linkedin.com/in/thomas-gentilhomme/"><img src="https://avatars.githubusercontent.com/u/4438263?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Gentilhomme</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=fraxken" title="Documentation">📖</a> <a href="#security-fraxken" title="Security">🛡️</a></td>
  </tr>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License
MIT
