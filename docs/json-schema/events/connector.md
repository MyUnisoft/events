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
    "metadata": {
      "$ref": "Metadata"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": "string",
        "code": "string"
      },
      "required": ["id", "code"]
    }
  },
  "required": ["name", "operation", "scope", "metadata", "data"]
}
```
