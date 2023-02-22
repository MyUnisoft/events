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
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": "string"
      },
      "required": ["id"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
