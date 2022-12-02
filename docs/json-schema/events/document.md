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
    "metadata": {
      "$ref": "Metadata"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": "string",
        "kind": ["AF", "PF", "DB"]
      },
      "required": ["id", "kind"]
    }
  },
  "required": ["name", "operation", "scope", "metadata", "data"]
}
```
