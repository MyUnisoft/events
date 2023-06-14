```json
{
  "description": "adminMessage event",
  "type": "object",
  "properties": {
    "event": {
      "type": "string",
      "value": "admin_message"
    },
    "socketMessage": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[0-9]+"
        },
        "title": {
          "type": "string"
        },
        "message": {
          "type": "string"
        }
      },
      "required": ["id", "title", "message"]
    },
    "receivers": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": ["event", "socketMessage", "receivers"]
}
```
