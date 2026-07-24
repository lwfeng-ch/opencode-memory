/**
 * opencode-memory — Embedded Runtime
 *
 * Single entry point for the MemoryOS Runtime subsystem.
 * Manages the API server and Console static server lifecycle.
 *
 * Usage:
 *   import { startRuntime, stopRuntime } from "./runtime/index.js";
 *   await startRuntime({ store, adapter, memoryDir });
 */

export { startRuntime, stopRuntime, getRuntimeStatus } from "./lifecycle.js";
export type { RuntimeConfig, RuntimeStatus } from "./lifecycle.js";
export { startApiServer, stopApiServer, getApiPort } from "./api-server.js";
export { startConsoleServer, stopConsoleServer, getConsolePort } from "./console-server.js";