export interface Operation {
  create: "CREATE";
  update: "UPDATE";
  delete: "DELETE";
  void: "VOID";
}

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
  }
}

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
  keyof Pick<Operation, "create">
];

export interface AccountingLineEntry {
  name: "accountingLineEntry";
  operation: AccountingLineEntryOperation;
  data: {
    id: string;
  }
}

export type AdminMessageOperation = Operation[
  keyof Pick<Operation, "void">
]

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

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
  document: Document;
  portfolio: Portfolio;
  accountingLineEntry: AccountingLineEntry;
  adminMessage: AdminMessage;
  thirdParty: ThirdParty;
}
