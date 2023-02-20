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
        "id": "string"
      },
      "required": ["id"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "metadata", "data"],
  "additionalProperties": false
}
```
