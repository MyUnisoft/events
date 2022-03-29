# Events-utils
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

```ts
import { ValidateEventDataOptions, validateEventData } from "@myunisoft/events";

const event: ValidateEventDataOptions = {
  name: "accountingFolder",
  operation: "CREATE",
  data: {
    accountingFolderId: 1
  }
};

validateEventData(event);
```

## Events Descriptions

### connector

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node.js  | ```{  connectorId: number ;}```  |
| UPDATE  | Node.js  | ```{  connectorId: number ;}```  |
| DELETE  | Node.js  | ```{  connectorId: number ;}```  |

---

### accountingFolder

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Windev  | ```{  accountingFolderId: number ;}```  |