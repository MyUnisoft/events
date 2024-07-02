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
        },
        "kind": {
          "enum": ["AF", "PF", "DB", "ED"]
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
