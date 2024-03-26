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
      "enum": ["CREATE", "UPDATE", "DELETE"]
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
