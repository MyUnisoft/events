// Import Node.js Dependencies
import { run } from "node:test";
import { spec } from "node:test/reporters";
import process from "node:process";

// Import Third-Party Dependencies
import { globSync } from "glob";
import { config } from "dotenv";
import { GenericContainer } from "testcontainers";

config();

// VARS & Config
const kRedisPort = 6379;
let redis;

async function startContainers() {
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
}

async function runTests() {
  const filePath = "./test/**/*.test.ts";
  await startContainers();

  const files = globSync(filePath);
  const testStream = run({ files, timeout: 30000 });

  testStream.on("test:fail", () => {
    process.exitCode = 1;
  });

  testStream.compose<spec>(new spec()).pipe(process.stdout);
}
runTests();
