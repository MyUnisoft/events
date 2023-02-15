```json
{
  "description": "Webhook",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "scope": {
        "$ref": "Scope"
      },
      "webhookId": {
        "type": "number"
      },
      "createdAt": {
        "type": "number"
      },
      "name": {
        "type": "string",
        "description": "event related name"
      },
      "operation": {
        "type": "string",
        "description": "event related operation",
        "enum": ["CREATE", "UPDATE", "DELETE", "VOID"]
      },
      "data": {
        "type": "object",
        "description": "event related data",
        "properties": {
          "id": {
            "type": "string"
          },
          "required": ["id"],
          "additionalProperties": true
        }
      }
    },
    "required": ["scope", "webhookId", "createdAt", "name", "operation", "data"],
    "additionalProperties": false
  }
}
```
