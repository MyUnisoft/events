export interface Operation {
  create: "CREATE",
  update: "UPDATE",
  delete: "DELETE",
  void: "VOID"
}

export interface Connector<K extends keyof Omit<Operation, "void"> = keyof Omit<Operation, "void">> {
  name: "connector";
  operation: Operation[K];
  data: {
    id: string | string[];
  }
}

export interface AccountingFolder<K extends keyof Omit<Operation, "update" | "delete" | "void"> =
keyof Omit<Operation, "update" | "delete" | "void">> {
  name: "accountingFolder";
  operation: Operation[K];
  data: {
    accountingFolderId: string;
  };
}

export interface Events {
  accountingFolder: AccountingFolder;
  connector: Connector;
}
