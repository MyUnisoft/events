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

export type ConnectorScope = Scope;

export interface Connector {
  name: "connector";
  scope: ConnectorScope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
    code: string;
    userId?: string | null;
  }
}

export type AccountingFolderScope = Scope & Required<Pick<Scope, "firmId">>;

export interface AccountingFolder {
  name: "accountingFolder";
  scope: AccountingFolderScope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
  };
}

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
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
    kind: DocumentKind;
    name: string;
  }
}

export type PortfolioScope = Scope;

export interface Portfolio {
  name: "portfolio";
  scope: PortfolioScope;
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
  }
}

export type AccountingLineEntryScope = Scope;

export interface AccountingLineEntry {
  name: "accountingLineEntry";
  scope: AccountingLineEntryScope;
  operation: "CREATE";
  data: {
    id: string;
  }
}

export type AdminMessageScope = Scope;

export interface AdminMessage {
  name: "adminMessage";
  scope: AdminMessageScope;
  operation: "VOID";
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

export type ThirdPartyScope = Scope;

export interface ThirdParty {
  name: "thirdParty";
  scope: ThirdPartyScope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    code: string;
  }
}

export type AccountingEntryLetteringScope = Scope;

export interface AccountingEntryLettering {
  name: "accountingEntryLettering";
  scope: AccountingEntryLetteringScope;
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
    piece2: string;
    paymentType: string;
    piece1?: string;
  }
}

export type CloudDocumentScope = Scope;

export interface CloudDocument {
  name: "cloudDocument";
  scope: CloudDocumentScope;
  operation: "CREATE" | "UPDATE";
  data: {
    id: string;
    status: "rejected" | "completed";
    reason?: string;
  }
}

export type PushNotificationScope = Scope & {
  persPhysiqueId: number;
  accountingFolderId: number;
};

export type DiscussionRoomOperation = Operation[
  keyof Pick<Operation, "create" | "update" | "delete">
];


export type DiscussionRoomScope = PushNotificationScope;

export interface DiscussionRoom<T extends DiscussionRoomOperation = DiscussionRoomOperation> {
  name: "discussion_room";
  scope: DiscussionRoomScope;
  operation: T;
  data: (T extends Operation[keyof Pick<Operation, "create" | "update">] ? {
    memberIds: number[];
  } : unknown) & {
    id: number;
    folderId: number;
    roomTypeId: number;
  };
}

export type DiscussionMessageScope = PushNotificationScope;

export interface DiscussionMessage {
  name: "discussion_message";
  scope: DiscussionMessageScope;
  operation: "CREATE" | "UPDATE";
  data: {
    id: number;
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
  discussionRoom: DiscussionRoom;
  discussionMessage: DiscussionMessage;
}
