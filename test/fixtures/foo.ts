export const foo = {
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "pattern": "foo"
    },
    "data": {
      "type": "object",
      "properties": {
        "foo": {
          "type": "string"
        }
      },
      "required": ["foo"],
      "additionalProperties": false
    }
  },
  "required": ["name", "data"],
  "additionalProperties": false
}
