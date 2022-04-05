# Events Descriptions

```ts
export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
}
```

## connector

```ts
export interface Connector {
  name: "connector";
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    connectorId: number;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | ```{  connectorId: number ;}```  |
| UPDATE  | Node  | ```{  connectorId: number ;}```  |
| DELETE  | Node  | ```{  connectorId: number ;}```  |

---

## accountingFolder

```ts
export interface AccountingFolder {
  name: "accountingFolder";
  operation: "CREATE";
  data: {
    accountingFolderId: number;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Windev  | ```{  accountingFolderId: number ;}```  |
