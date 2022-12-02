export interface Operation {
  create: "CREATE",
  update: "UPDATE",
  delete: "DELETE",
  void: "VOID"
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
  BaseDocumentaire = "DB"
}

export interface Document {
  name: "document";
  operation: DocumentOperation;
  data: {
    id: string;
    kind: DocumentKind;
  }
}

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
  document: Document;
}
