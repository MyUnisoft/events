module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  collectCoverage: true,
  collectCoverageFrom: [
    "**/src/**/**/*.ts"
  ],
  setupFilesAfterEnv: [
    "./jest.setup.js"
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/test/fixtures/"
  ],
  testMatch: [
    "**/test/**/*.spec.ts"
  ],
  maxWorkers: 1,
  globalSetup: "./start-container.js",
  transform: {
    "\\.[jt]sx?$": "ts-jest"
  },
  moduleNameMapper: {
    "(.+)\\.js": "$1"
  },
  extensionsToTreatAsEsm: [".ts"]
};
