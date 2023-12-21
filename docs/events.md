```ts
export interface Operation {
  create: "CREATE";
  update: "UPDATE";
  delete: "DELETE";
  void: "VOID";
}

export interface Scope {
  schemaId: number;
  firmId?: number | null;
  firmSIRET?: number | null;
  accountingFolderId?: number | null;
  accountingFolderSIRET?: number | null;
  accountingFolderRef?: string | null;
  persPhysiqueId?: number | null;
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

export type ConnectorScope = Scope;

export interface Connector {
  name: "connector";
  scope: ConnectorScope;
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

- **Operations**: CREATE, UPDATE
- [JSON Schema](./json-schema/events/accountingFolder.md)

```ts
export type AccountingFolderOperation = Operation[
  keyof Pick<Operation, "create" | "update">
];

export type AccountingFolderScope = Scope & Required<Pick<Scope, "firmId">>;

export interface AccountingFolder {
  name: "accountingFolder";
  scope: AccountingFolderScope;
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

export type DocumentScope = Scope;

export enum DocumentKind {
  DossierAnnuel = "AF",
  DossierPermanent = "PF",
  BaseDocumentaire = "DB",
  ExternalDocument = "ED"
}

export interface Document {
  name: "document";
  scope: DocumentScope;
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

export type PortfolioScope = Scope;

export interface Portfolio {
  name: "portfolio";
  scope: PortfolioScope;
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

export type AccountingLineEntryScope = Scope;

export interface AccountingLineEntry {
  name: "accountingLineEntry";
  scope: AccountingLineEntryScope;
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

export type AdminMessageScope = Scope;

export interface AdminMessage {
  name: "adminMessage";
  scope: AdminMessageScope;
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
];

export type ThirdPartyScope = Scope;


export interface ThirdParty {
  name: "thirdParty";
  scope: ThirdPartyScope;
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
  keyof Pick<Operation, "create" | "delete">
];

export type AccountingEntryLetteringScope = Scope;

export interface AccountingEntryLettering {
  name: "accountingEntryLettering";
  scope: AccountingEntryLetteringScope;
  operation: AccountingEntryLetteringOperation;
  data: {
    id: string;
    piece2: string;
    paymentType: string;
    piece1?: string;
  }
}
```

# CloudDocument

- **Operations**: CREATE, UPDATE
- [JSON Schema](./json-schema/events/cloudDocument.md)

```ts
export type CloudDocumentOperation = Operation[
  keyof Pick<Operation, "create" | "update">
];

export type CloudDocumentScope = Scope;

export interface CloudDocument {
  name: "cloudDocument";
  scope: CloudDocumentScope;
  operation: CloudDocumentOperation;
  data: {
    id: string;
    status: "rejected" | "completed";
    reason?: string;
  }
}
```
