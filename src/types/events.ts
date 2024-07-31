export type Operation = "CREATE" | "UPDATE" | "DELETE" | "VOID";

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";
    requestId?: string;
  };
  createdAt: number;
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

export interface Connector {
  name: "connector";
  scope: Scope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
    code: string;
    userId?: string | null;
  }
}

export interface AccountingFolder {
  name: "accountingFolder";
  scope: Scope & Required<Pick<Scope, "firmId">>;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
  };
}

export enum DocumentKind {
  DossierAnnuel = "AF",
  DossierPermanent = "PF",
  BaseDocumentaire = "DB",
  ExternalDocument = "ED"
}

export interface Document {
  name: "document";
  scope: Scope;
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
    kind: DocumentKind;
    name: string;
  }
}

export interface Portfolio {
  name: "portfolio";
  scope: Scope;
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
  }
}

export interface AccountingLineEntry {
  name: "accountingLineEntry";
  scope: Scope;
  operation: "CREATE";
  data: {
    id: string;
  }
}

export interface AdminMessage {
  name: "adminMessage";
  scope: Scope;
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

export interface ThirdParty {
  name: "thirdParty";
  scope: Scope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    code: string;
  }
}

export interface AccountingEntryLettering {
  name: "accountingEntryLettering";
  scope: Scope;
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
    piece2: string;
    paymentType: string;
    piece1?: string;
  }
}

export interface CloudDocument {
  name: "cloudDocument";
  scope: Scope;
  operation: "CREATE" | "UPDATE";
  data: {
    id: string;
    status: "rejected" | "completed";
    reason?: string;
  }
}

export type PushNotificationScope = Scope & {
  persPhysiqueId: number;
};

export type DiscussionRoomOperation = Operation[
  keyof Pick<Operation, "create" | "update" | "delete">
];

export type DiscussionRoomScope = PushNotificationScope;

export interface DiscussionRoom {
  name: "discussion_room";
  scope: DiscussionRoomScope;
  operation: DiscussionRoomOperation;
  data: {
    id: number;
  }
}

export type DiscussionMessageOperation = Operation[
  keyof Pick<Operation, "create" | "update">
];

export type DiscussionMessageScope = PushNotificationScope;

export interface DiscussionMessage {
  name: "discussion_message";
  scope: DiscussionMessageScope;
  operation: DiscussionMessageOperation;
  data: {
    id: number;
  }
}

export type DiscussionUnreadMessageOperation = Operation[
  keyof Pick<Operation, "create" | "update">
];

export type DiscussionUnreadMessageScope = PushNotificationScope;

export interface DiscussionUnreadMessage {
  name: "discussion_unread_message";
  scope: DiscussionUnreadMessageScope;
  operation: DiscussionUnreadMessageOperation;
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
  discussionUnreadMessage: DiscussionUnreadMessage;
}
