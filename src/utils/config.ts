export const redisPort = process.env.MYUNISOFT_REDIS_PORT ?? 6379;

export const incomerStoreName = "incomer";
export const transactionStoreName = "transaction";

export const channels = {
  dispatcher: "dispatcher"
};

export const predefinedEvents = {
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
    },
    check: {
      /* Send as a response to a ping */
      pong: "pong"
    }
  },
  ack: "ack"
};
