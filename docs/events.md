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
    connectorId: string;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | ```{  connectorId: string ;}```  |
| UPDATE  | Node  | ```{  connectorId: string ;}```  |
| DELETE  | Node  | ```{  connectorId: string ;}```  |

---

## accountingFolder

```ts
export interface AccountingFolder {
  name: "accountingFolder";
  operation: "CREATE";
  data: {
    accountingFolderId: string;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Windev  | ```{  accountingFolderId: string ;}```  |
