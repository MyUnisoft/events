```ts
export interface Operation {
  create: "CREATE";
  update: "UPDATE";
  delete: "DELETE";
  void: "VOID";
}
```

# Connector

Event notifying the modification of a partner integration.

- **Operations**: CREATE, UPDATE, DELETE
- [JSON Schema](./json-schema/events/connector.md)

```ts
export type ConnectorOperation = Operation[
  keyof Omit<Operation, "void">
];

export interface Connector {
  name: "connector";
  operation: ConnectorOperation;
  data: {
    id: string;
    code: string;
    userId?: string | null;
  };
}
```

# AccountingFolder

Event notifying the creation of a new Accounting Folder (a company). 

- **Operations**: CREATE
- [JSON Schema](./json-schema/events/accountingFolder.md)

```ts
export type AccountingFolderOperation = Operation[
  keyof Pick<Operation, "create">
];

export interface AccountingFolder {
  name: "accountingFolder";
  operation: AccountingFolderOperation;
  data: {
    id: string;
  };
}
```

# Document

Event notifying the creation/addition of a document.

- **Operations**: CREATE
- [JSON Schema](./json-schema/events/document.md)

```ts
export type DocumentOperation = Operation[
  keyof Pick<Operation, "create">
];

export enum DocumentKind {
  DossierAnnuel = "AF",
  DossierPermanent = "PF",
  BaseDocumentaire = "DB",
  ExternalDocument = "ED"
}

export interface Document {
  name: "document";
  operation: DocumentOperation;
  data: {
    id: string;
    kind: DocumentKind;
  };
}
```

# Portfolio

Event notifying the creation or deletion of an Accounting Portfolio (or Accounting Wallet). Wallet allow to define access to a set of accounting folders.

- **Operations**: CREATE, DELETE
- [JSON Schema](./json-schema/events/portfolio.md)

```ts
export type PortfolioOperation = Operation[
  keyof Omit<Operation, "update" | "void">
];

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
- [JSON Schema](./json-schema/events/accountingLineEntry.md)

```ts
export type AccountingLineEntryOperation = Operation[
  keyof Pick<Operation, "create">
];

export interface AccountingLineEntry {
  name: "accountingLineEntry";
  operation: AccountingLineEntryOperation;
  data: {
    id: string;
  }
}
```

# AdminMessage

- **Operations**: VOID 
- [JSON Schema](./json-schema/events/adminMessage.md)

```ts
export type AdminMessageOperation = Operation[
  keyof Pick<Operation, "void">
];

export interface AdminMessage {
  name: "adminMessage";
  operation: AdminMessageOperation;
  data: {
    event: "admin_message";
    socketMessage: {
      id: number;
      title: string;
      message: string;
    };
    receivers: string[];
  }
}
```

# ThirdParty

- **Operations**: CREATE, UPDATE, DELETE
- [JSON Schema](./json-schema/events/thirdParty.md)

```ts
export type ThirdPartyOperation = Operation[
  keyof Omit<Operation, "void">
]

export interface ThirdParty {
  name: "thirdParty";
  operation: ThirdPartyOperation;
  data: {
    code: string;
  }
}
```

# AccountingEntryLettering

- **Operations**: CREATE
- [JSON Schema](./json-schema/events/accountingEntryLettering.md)

```ts
export type AccountingEntryLetteringOperation = Operation[
  keyof Pick<Operation, "create">
];

export interface AccountingEntryLettering {
  name: "accountingEntryLettering";
  operation: AccountingEntryLetteringOperation;
  data: {
    id: string;
    piece2: string;
    paymentType: string;
    piece1?: string;
  }
}
```
