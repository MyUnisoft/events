export type Operation = "CREATE" | "UPDATE" | "DELETE" | "VOID";

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    // eslint-disable-next-line @typescript-eslint/ban-types
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | (string & {});
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
  operation: "CREATE";
  data: {
    id: string;
  };
}

export const DOCUMENT_KIND = Object.freeze({
  DossierAnnuel: "AF",
  DossierPermanent: "PF",
  BaseDocumentaire: "DB",
  ExternalDocument: "ED",
  MiscellaneousFlow: "MF"
});

export interface Document {
  name: "document";
  scope: Scope;
  operation: "CREATE";
  data: {
    id: string;
    kind: typeof DOCUMENT_KIND[keyof typeof DOCUMENT_KIND];
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

export interface Exercice {
  name: "exercice";
  scope: Scope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
  }
}

export interface VisitedPage {
  name: "visitedPage";
  scope: Scope & Required<Pick<Scope, "accountingFolderId" | "persPhysiqueId">>;
  operation: "VOID";
  data: {
    path: string;
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
  exercice: Exercice;
  visitedPage: VisitedPage;
}
