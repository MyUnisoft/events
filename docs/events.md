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
    id: string;
  };
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | ```{  id: string ;}```  |
| UPDATE  | Node  | ```{  id: string ;}```  |
| DELETE  | Node  | ```{  id: string ;}```  |

---

## accountingFolder

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
