export interface Operation {
  create: "CREATE";
  update: "UPDATE";
  delete: "DELETE";
  void: "VOID";
}

export type ConnectorOperation = Operation[keyof Omit<Operation, "void">];

export interface Connector {
  name: "connector";
  operation: ConnectorOperation;
  data: {
    id: string;
    code: string;
  }
}

export type AccountingFolderOperation = Operation[
  keyof Omit<Operation, "update" | "delete" | "void">
];

export interface AccountingFolder {
  name: "accountingFolder";
  operation: AccountingFolderOperation;
  data: {
    id: string;
  };
}

export type DocumentOperation = Operation[
  keyof Omit<Operation, "update" | "delete" | "void">
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
  }
}

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

export type AccountingLineEntryOperation = Operation[
  keyof Omit<Operation, "update" | "delete" | "void">
];

export interface AccountingLineEntry {
  name: "accountingLineEntry";
  operation: AccountingLineEntryOperation;
  data: {
    id: string;
  }
}

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
  document: Document;
  portfolio: Portfolio;
  accountingLineEntry: AccountingLineEntry;
}
