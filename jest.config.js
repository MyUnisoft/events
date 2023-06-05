module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  collectCoverage: true,
  collectCoverageFrom: [
    "**/src/**/**/*.ts"
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/test/fixtures/"
  ],
  testMatch: [
    "**/test/**/*.spec.ts"
  ],
  maxWorkers: 1,
  globalSetup: "./start-container.js"
};
