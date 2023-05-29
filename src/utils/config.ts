export const REDIS_PORT = process.env.REDIS_PORT;
export const REDIS_HOST = process.env.REDIS_HOST;

export const kIncomerStoreName = "incomer" as const;
export const kTransactionStoreName = "transaction" as const;

export const channels = {
  dispatcher: "dispatcher"
};

export const predefinedEvents = Object.freeze({
  dispatcher: {
    /* Events relative to the registration of a new incomer */
    registration: {
      /* Send to communicate a unique identifier to the incomer */
      approvement: "approvement"
    },
    check: {
      /* Send to check if a incomer is still alive */
      ping: "ping"
    }
  },
  incomer: {
    registration: {
      /* Send to communicate his new existence to the gateway */
      register: "register"
    }
  },
  ack: "ack"
});
