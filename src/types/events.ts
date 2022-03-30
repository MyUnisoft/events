export interface Connector {
  name: "connector";
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    connectorId: number;
  };
}

export interface AccountingFolder {
  name: "accountingFolder";
  operation: "CREATE";
  data: {
    accountingFolderId: number;
  };
}

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
}
