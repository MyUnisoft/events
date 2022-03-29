export type Events = "accountingFolder" | "connector";

// Events
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

export interface EventsDefinition {
  accountingFolder: AccountingFolder;
  connector: Connector;
}


interface Scope {
  schemaId: number;
  accountingFolderId?: number;
}

export type WebhookResponse<K extends keyof EventsDefinition = keyof EventsDefinition> = {
  scope: Scope;
  webhookId: string;
  createdAt: number;
} & EventsDefinition[K];


export type WebhooksResponse<T extends (keyof EventsDefinition)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

