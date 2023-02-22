# Connector

Event notifying the modification of a partner integration.

- **Operations**: CREATE, UPDATE, DELETE
- [JSON Schema](./json-schema/events/connector.md)

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

# AccountingFolder

Event notifying the creation of a new Accounting Folder (a company). 

- **Operations**: CREATE
- [JSON Schema](./json-schema/events/accountingFolder.md)

```ts
export interface AccountingFolder {
  name: "accountingFolder";
  operation: "CREATE";
  data: {
    id: string;
  };
}
```

# Document

Event notifying the creation/addition of a document.

- **Operations**: CREATE
- [JSON Schema](./docs/json-schema/events/document.md)

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

# Portfolio

Event notifying the creation or deletion of an Accounting Portfolio (or Accounting Wallet). Wallet allow to define access to a set of accounting folders.

- **Operations**: CREATE, DELETE
- [JSON Schema](./docs/json-schema/events/portfolio.md)

```ts
export interface Portfolio {
  name: "portfolio";
  operation: PortfolioOperation;
  data: {
    id: string;
  }
}
```

# AccountingLineEntry

- **Operations**: CREATE
- [JSON Schema](./docs/json-schema/events/accountingLineEntry.md)

```ts
export interface AccountingLineEntry {
  name: "accountingLineEntry";
  operation: AccountingLineEntryOperation;
  data: {
    id: string;
  }
}
```
