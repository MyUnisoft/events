# Connector

[JSON Schema](./json-schema/events/connector.md)

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

# AccountingFolder

[JSON Schema](./json-schema/events/accountingFolder.md)

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

# Document

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

# Portfolio

[JSON Schema](./docs/json-schema/events/portfolio.md)

```ts
export interface Portfolio {
  name: "portfolio";
  operation: PortfolioOperation;
  data: {
    id: string;
  }
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | <pre>{ <br/> &emsp; id: string; <br/>}</pre>  |
| DELETE  | Node  | <pre>{ <br/> &emsp; id: string; <br/>}</pre> |

# AccountingLineEntry

[JSON Schema](./docs/json-schema/events/accountingLineEntry.md)

```ts
export interface AccountingLineEntry {
  name: "accountingLineEntry";
  operation: AccountingLineEntryOperation;
  data: {
    id: string;
  }
}
```

| Operation  | Agent  | Payload  |
|---|---|---|
| CREATE  | Node  | <pre>{ <br/> &emsp; id: string; <br/>}</pre>  |

