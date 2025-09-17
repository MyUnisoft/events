# Event

```ts
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
```

<details>
<summary>Scope JSON Schema</summary>

```json
{
  "$id": "Scope",
  "description": "Object related to the scope of an event",
  "type": "object",
  "properties": {
    "schemaId": {
      "type": "number"
    },
    "firmId": {
      "type": "number",
      "nullable": true
    },
    "firmSIRET": {
        "type": "number",
        "nullable": true
      },
    "accountingFolderId": {
      "type": "number",
      "nullable": true
    },
    "accountingFolderSIRET": {
      "type": "number",
      "nullable": true
    },
    "accountingFolderRef": {
      "type": "string",
      "nullable": true
    },
    "persPhysiqueId": {
      "type": "number",
      "nullable": true
    }
  },
  "required": ["schemaId"],
  "additionalProperties": false
}
```
</details>

## Connector

Event notifying the modification of a partner integration.

```ts
export interface Connector {
  name: "connector";
  scope: Scope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
    code: string;
    userId?: string | null;
  };
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "Connector event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "connector"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "UPDATE", "DELETE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "code": {
          "type": "string"
        },
        "userId": {
          "type": "string",
          "nullable": true
        }
      },
      "required": ["id", "code"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>

## AccountingFolder

Event notifying the creation of a new Accounting Folder (a company). 

```ts
export interface AccountingFolder {
  name: "accountingFolder";
  scope: Scope & Required<Pick<Scope, "firmId">>;
  operation: "CREATE";
  data: {
    id: string;
  };
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "AccountingFolder event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "accountingFolder"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE"]
    },
    "scope": {
      "type": "object",
      "properties": {
        "schemaId": {
          "type": "number"
        },
        "firmId": {
          "type": "number"
        },
        "firmSIRET": {
            "type": "number",
            "nullable": true
          },
        "accountingFolderId": {
          "type": "number",
          "nullable": true
        },
        "accountingFolderSIRET": {
          "type": "number",
          "nullable": true
        },
        "accountingFolderRef": {
          "type": "string",
          "nullable": true
        },
        "persPhysiqueId": {
          "type": "number",
          "nullable": true
        }
      },
      "required": ["schemaId", "firmId"],
      "additionalProperties": false
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": ["id"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>

## Document

Event notifying the creation/addition of a document.

```ts
export const DOCUMENT_KIND = Object.freeze({
  DossierAnnuel: "AF",
  DossierPermanent: "PF",
  BaseDocumentaire: "DB",
  ExternalDocument: "ED",
  MiscellaneousFlow: "MF"
});

export type DocumentKind = typeof DOCUMENT_KIND[keyof typeof DOCUMENT_KIND];

export interface Document {
  name: "document";
  scope: Scope;
  operation: "CREATE";
  data: {
    id: string;
    kind: typeof DOCUMENT_KIND[keyof typeof DOCUMENT_KIND];
    name: string;
  };
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "Document event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "document"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "kind": {
          "enum": ["AF", "PF", "DB", "ED", "MF"]
        },
        "name": {
          "type": "string"
        }
      },
      "required": ["id", "kind", "name"]
    }
  },
  "required": ["name", "operation", "scope", "data"]
}
```
</details>

## Portfolio

Event notifying the creation or deletion of an Accounting Portfolio (or Accounting Wallet). Wallet allow to define access to a set of accounting folders.

```ts
export interface Portfolio {
  name: "portfolio";
  scope: Scope;
  operation: "CREATE" | "DELETE";
  data: {
    id: string;
  }
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "Portfolio event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "portfolio"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "DELETE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": ["id"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>

## AccountingLineEntry

```ts
export interface AccountingLineEntry {
  name: "accountingLineEntry";
  scope: Scope;
  operation: "CREATE;
  data: {
    id: string;
  }
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "accountingLineEntry event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "accountingLineEntry"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": ["id"]
    }
  },
  "required": ["name", "operation", "scope", "data"]
}
```
</details>

## AdminMessage

```ts
export interface AdminMessage {
  name: "adminMessage";
  scope: Scope;
  operation: "VOID;
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
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "adminMessage event",
  "type": "object",
  "properties": {
    "event": {
      "type": "string",
      "value": "admin_message"
    },
    "socketMessage": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number"
        },
        "title": {
          "type": "string"
        },
        "message": {
          "type": "string"
        }
      },
      "required": ["id", "title", "message"]
    },
    "receivers": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": ["event", "socketMessage", "receivers"]
}
```
</details>

## ThirdParty

```ts
export interface ThirdParty {
  name: "thirdParty";
  scope: Scope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    code: string;
  }
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "Third-party event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "thirdParty"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "UPDATE", "DELETE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string"
        }
      },
      "required": ["code"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>

## AccountingEntryLettering

```ts
export interface AccountingEntryLettering {
  name: "accountingEntryLettering";
  scope: Scope;
  operation: "CREATE";
  data: {
    id: string;
    paymentType: string;
    piece1?: string;
  }
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "accountingEntryLettering event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "accountingEntryLettering"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "DELETE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[0-9]+"
        },
        "paymentType": {
          "type": "string"
        },
        "piece1": {
          "type": "string"
        }
      },
      "required": ["id", "paymentType"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>

## CloudDocument

```ts
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
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "CloudDocument event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "cloudDocument"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "UPDATE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "status": {
          "enum": ["reject", "completed"]
        },
        "reason": {
          "type": "string",
          "nullable": true
        }
      },
      "required": ["id", "status"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>

## Exercice

```ts
export interface Exercice {
  name: "exercice";
  scope: Scope;
  operation: "CREATE" | "UPDATE" | "DELETE";
  data: {
    id: string;
  }
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "Exercice event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "exercice"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "UPDATE", "DELETE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": ["id"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>


## VisitedPage

```ts
export interface VisitedPage {
  name: "visitedPage";
  scope: Scope & Required<Pick<Scope, "accountingFolderId" | "persPhysiqueId">>;
  operation: "VOID";
  data: {
    path: string;
  }
}
```

<details>
<summary>JSON Schema</summary>

```json
{
  "description": "VisitedPage event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "visitedPage"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["VOID"]
    },
    "scope": {
      "type": "object",
      "properties": {
        "schemaId": {
          "type": "number"
        },
        "persPhysiqueId": {
          "type": "number"
        },
        "accountingFolderId": {
          "type": "number"
        },
        "firmId": {
          "type": "number",
          "nullable": true
        },
        "firmSIRET": {
          "type": "number",
          "nullable": true
        },
        "accountingFolderSIRET": {
          "type": "number",
          "nullable": true
        },
        "accountingFolderRef": {
          "type": "string",
          "nullable": true
        }
      },
      "required": ["schemaId", "persPhysiqueId", "accountingFolderId"],
      "additionalProperties": false
    },
    "data": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": ["path"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
</details>
