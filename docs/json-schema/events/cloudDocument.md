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
