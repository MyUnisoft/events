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
        "id": "string"
      },
      "required": ["id"]
    }
  },
  "required": ["name", "operation", "scope", "data"]
}
```
