# Events Descriptions

```ts
export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
}
```

## connector

[JSON Schema](./json-schema/events/connector.json)

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
| CREATE  | Node  | ```{  id: string ; code: string; }```  |
| UPDATE  | Node  | ```{  id: string ; code: string; }```  |
| DELETE  | Node  | ```{  id: string ; code: string; }```  |

---

## accountingFolder

[JSON Schema](./json-schema/events/accountingFolder.json)

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
| CREATE  | Windev  | ```{  id: string ;}```  |
