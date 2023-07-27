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
