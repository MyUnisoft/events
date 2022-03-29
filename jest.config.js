module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  maxWorkers: 1,
  moduleNameMapper: {
    "^#src/(.*)$": "<rootDir>/src/$1"
  },
  setupFiles: ["dotenv/config"],
  setupFilesAfterEnv: [
    "./jest.setup.js"
  ],
  collectCoverage: true,
  collectCoverageFrom: [
    "**/src/**/*.ts"
  ],
  testMatch: [
    "**/test/**/*.spec.ts"
  ],
  globalSetup: "./start-container.js"
};
