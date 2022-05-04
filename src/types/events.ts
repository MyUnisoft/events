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
    id: string | string[];
  }
}

export type AccountingFolderOperation = Operation[
  keyof Omit<Operation, "update" | "delete" | "void">
];

export interface AccountingFolder {
  name: "accountingFolder";
  operation: AccountingFolderOperation;
  data: {
    accountingFolderId: string;
  };
}

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
}
