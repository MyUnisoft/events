export * from "./defaultStandardLog.js";
export * from "./ajv.js";

export function handleLoggerMode(
  mode: string
): string {
  return (mode === "info" || mode === "debug" || mode === "warn" || mode === "silent") ? mode : "info";
}
