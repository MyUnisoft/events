```json
{
  "description": "Third-party event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "thirdParty"
    },
    "operation": {
      "type": "string",
      "description": "Operation operated next to the event",
      "enum": ["CREATE", "UPDATE", "DELETE"]
    },
    "scope": {
      "$ref": "Scope"
    },
    "data": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string"
        }
      },
      "required": ["code"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```
