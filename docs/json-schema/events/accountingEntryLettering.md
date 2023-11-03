```json
{
  "description": "accountingEntryLettering event",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "value": "accountingEntryLettering"
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
          "type": "string",
          "pattern": "^[0-9]+"
        },
        "piece2": {
          "type": "string"
        },
        "paymentType": {
          "type": "string"
        },
        "piece1": {
          "type": "string"
        }
      },
      "required": ["id", "piece2", "paymentType"],
      "additionalProperties": false
    }
  },
  "required": ["name", "operation", "scope", "data"],
  "additionalProperties": false
}
```

