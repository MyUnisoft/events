<p align="center"><h1 align="center">
  Events
</h1></p>

<p align="center">
  MyUnisoft Events validator, schemas and types (useful to work with Webhooks).
</p>

<p align="center">
  <a href="https://github.com/MyUnisoft/events">
    <img src="https://img.shields.io/github/package-json/v/MyUnisoft/events?style=flat-square" alt="npm version">
  </a>
  <a href="https://github.com/MyUnisoft/events">
    <img src="https://img.shields.io/github/license/MyUnisoft/events?style=flat-square" alt="license">
  </a>
  <a href="https://github.com/MyUnisoft/events">
    <img src="https://img.shields.io/github/languages/code-size/MyUnisoft/events?style=flat-square" alt="size">
  </a>
</p>

## 🚧 Requirements

- [Node.js](https://nodejs.org/en/) version 18 or higher
- Docker (for running tests).

## 🚀 Getting Started

This package is available in the Node Package Repository and can be easily installed with [npm](https://doc.npmjs.com/getting-started/what-is-npm) or [yarn](https://yarnpkg.com)

```bash
$ npm i @myunisoft/events
# or
$ yarn add @myunisoft/events
```

<details>
<summary>Configure environment variables</summary>
<br>

| variable | description | default |
| --- | --- | --- |
| `MYUNISOFT_EVENTS_LOGGER_MODE` | Set log level for the default logger | `info` |
| <b>Dispatcher</b> |
| `MYUNISOFT_DISPATCHER_IDLE_TIME` | Interval threshold when Dispatcher become idle | `600_000` |
| `MYUNISOFT_DISPATCHER_CHECK_LAST_ACTIVITY_INTERVAL` | Dispatcher checking last activity interval | `120_000` |
| `MYUNISOFT_DISPATCHER_BACKUP_TRANSACTION_STORE_NAME` | Default name for backup transaction store | `backup` |
| `MYUNISOFT_DISPATCHER_INIT_TIMEOUT` | Dispatcher initialisation timeout | `3_500` |
| `MYUNISOFT_DISPATCHER_PING_INTERVAL` | Dispatcher ping interval | `3_500` |
| <b>Incomer</b> |
| `MYUNISOFT_INCOMER_INIT_TIMEOUT` | Incomer initialisation timeout | `3_500` |
| `MYUNISOFT_EVENTS_INIT_EXTERNAL` | Whenever Incomer should initialize an external Dispatcher | `false` |
| `MYUNISOFT_INCOMER_MAX_PING_INTERVAL` | Maximum ping interval | `60_000` |
| `MYUNISOFT_INCOMER_PUBLISH_INTERVAL` | Publish interval | `60_000` |
| `MYUNISOFT_INCOMER_IS_DISPATCHER` | Weither Incomer is a Dispatcher | `false` |

Some options takes the lead over environment variables.
For instance with: `new Incomer({ dispatcherInactivityOptions: { maxPingInterval: 900_000 }})` the max ping interval will be `900_000` even if `MYUNISOFT_INCOMER_MAX_PING_INTERVAL` variable is set.

</details>

## 📚 Usage example

```ts
import * as Events, { type EventOptions } from "@myunisoft/events";

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

Events.validate(event);
```

You can also use additional APIs to validate and narrow the data type depending on the operation:

```ts
if (Events.isCreateOperation(event.operation)) {
  // Do some code
}
else if (Events.isUpdateOperation(event.operation)) {
  // Do some code
}
else if (Events.isDeleteOperation(event.operation)) {
  // Do some code
}
```

> [!NOTE]
> 👀 See [**here**](./docs/events.md) for the exhaustive list of Events.

## 💡 What is an Event?

A fully constituted event is composed of a `name`, an `operation`, and multiple objects such as `data`, `scope` and `metadata`.
- The `name` identifies the event.
- The `operation` defines if it is a creation, update, or deletion.
- Based on the name, we know the **data** and the different `metadata.origin.method` related to it.
- The `metadata` object is used to determine various pieces of information, such as the entry point.
- The `scope` defines the **who**.

```ts
export interface Scope {
  schemaId: number;
  firmId?: number | null;
  firmSIRET?: number | null;
  accountingFolderId?: number | null;
  accountingFolderSIRET?: number | null;
  accountingFolderRef?: string | null;
  persPhysiqueId?: number | null;
}

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";
    requestId?: string;
  };
  createdAt: number;
}
```

## API

- [Dispatcher](./docs/class/dispatcher.md)
- [Incomer](./docs/class/incomer.md)

### validate< T extends keyof Events >(options: EventOptions<T>): void

Throw an error if a given event is not recognized internally.

### isCreateOperation< T extends keyof Events >(operation: EventOptions<T>["operation"]): operation is Operation["create"]

### isUpdateOperation< T extends keyof Events >(operation: EventOptions<T>["operation"]): operation is Operation["update"]

### isDeleteOperation< T extends keyof Events >(operation: EventOptions<T>["operation"]): operation is Operation["delete"]

---

EventOptions is described by the following type:
```ts
export type EventOptions<K extends keyof EventsDefinition.Events> = {
  scope: Scope;
  metadata: Metadata;
} & EventsDefinition.Events[K];
```

## Exploiting Webhooks

👀 See [**the root example/fastify**](./example/fastify/feature/webhook.ts) for an example of utilizing webhooks with an HTTP server.

In TypeScript, webhooks can be described using the `WebhookResponse` type:
```ts
import type { WebhookResponse } from "@myunisoft/events";

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
    webhookId: "1",
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
    webhookId: "2",
    createdAt: Date.now()
  },
];
```

<details>
<summary>Webhook JSON Schema</summary>

```json
{
  "description": "Webhook",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "scope": {
        "$ref": "Scope"
      },
      "webhookId": {
        "type": "string"
      },
      "createdAt": {
        "type": "number"
      },
      "name": {
        "type": "string",
        "description": "event related name"
      },
      "operation": {
        "type": "string",
        "description": "event related operation",
        "enum": ["CREATE", "UPDATE", "DELETE", "VOID"]
      },
      "data": {
        "type": "object",
        "description": "event related data",
        "properties": {
          "id": {
            "type": "string"
          },
          "required": ["id"],
          "additionalProperties": true
        }
      }
    },
    "required": ["scope", "webhookId", "createdAt", "name", "operation", "data"],
    "additionalProperties": false
  }
}
```
</details>

## Contributors ✨

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-4-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://www.linkedin.com/in/nicolas-hallaert/"><img src="https://avatars.githubusercontent.com/u/39910164?v=4?s=100" width="100px;" alt="Nicolas Hallaert"/><br /><sub><b>Nicolas Hallaert</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Documentation">📖</a> <a href="https://github.com/MyUnisoft/events/commits?author=Rossb0b" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://sofiand.github.io/portfolio-client/"><img src="https://avatars.githubusercontent.com/u/39944043?v=4?s=100" width="100px;" alt="Yefis"/><br /><sub><b>Yefis</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=SofianD" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=SofianD" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://www.linkedin.com/in/thomas-gentilhomme/"><img src="https://avatars.githubusercontent.com/u/4438263?v=4?s=100" width="100px;" alt="Gentilhomme"/><br /><sub><b>Gentilhomme</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=fraxken" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/PierreDemailly"><img src="https://avatars.githubusercontent.com/u/39910767?v=4?s=100" width="100px;" alt="PierreDemailly"/><br /><sub><b>PierreDemailly</b></sub></a><br /><a href="https://github.com/MyUnisoft/events/commits?author=PierreDemailly" title="Code">💻</a> <a href="https://github.com/MyUnisoft/events/commits?author=PierreDemailly" title="Documentation">📖</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License
MIT
