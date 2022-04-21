export interface Connector {
  name: "connector";
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    connectorId: string;
  };
}

export interface AccountingFolder {
  name: "accountingFolder";
  operation: "CREATE";
  data: {
    accountingFolderId: string;
  };
}

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
}
