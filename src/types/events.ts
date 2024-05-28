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
  }
}

export type AccountingFolderOperation = Operation[
  keyof Pick<Operation, "create" | "update" | "delete">
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

export type DocumentOperation = Operation[
  keyof Pick<Operation, "create" | "delete">
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
  }
}

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

export type PushNotificationOperation = Operation[
  keyof Pick<Operation, "create">
];

export type PushNotificationScope = Scope;

export type PushNotificationType = "room_deleted" | "message_created" | "message_updated" | "unread_message_created";

export interface PushNotification {
  name: "pushNotification";
  scope: PushNotificationScope;
  operation: PushNotificationOperation;
  data: {
    type: "room_deleted" | "message_created" | "message_updated" | "unread_message_created";
    data: Record<string, any>;
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
  accountingEntryLettering: AccountingEntryLettering;
  cloudDocument: CloudDocument;
  pushNotification: PushNotification;
}
