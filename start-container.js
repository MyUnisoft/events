// Third-party Dependencies
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer } = require("testcontainers");

// VARS & Config
const kRedisPort = 6379;
let redis;

module.exports = async function startContainers() {
  console.info("\nStarting containers ...");

  try {
    console.info("Starting redis ...");
    redis = await new GenericContainer("redis")
      .withExposedPorts(kRedisPort)
      .start();

    process.env.REDIS_PORT = redis.getMappedPort(kRedisPort);
    process.env.REDIS_HOST = redis.getHost();
  }
  catch (error) {
    console.error(error);

    throw new Error("Error during spawn a redis container");
  }
};

process.on("SIGTERM", () => {
  if (redis && redis.stop) {
    redis.stop();
  }
});
