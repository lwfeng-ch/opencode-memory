/**
 * opencode-memory — Runtime Lifecycle Manager
 *
 * Manages the startup state of the Memory Runtime.
 * Prevents duplicate starts on plugin reload.
 * Provides a single entry point for the entire runtime subsystem.
 */

import type { MemoryStore } from "../store.js";
import type { RuntimeAdapter } from "../adapter.js";
import { startApiServer, stopApiServer } from "./api-server.js";
import { startConsoleServer, stopConsoleServer } from "./console-server.js";

let runtimeStarted = false;

export interface RuntimeConfig {
  store: MemoryStore;
  adapter: RuntimeAdapter;
  memoryDir: string;
  api?: {
    enabled?: boolean;
    host?: string;
    port?: number;
  };
  console?: {
    enabled?: boolean;
    host?: string;
    port?: number;
  };
}

export interface RuntimeStatus {
  api: { running: boolean; port: number };
  console: { running: boolean; port: number };
}

export async function startRuntime(config: RuntimeConfig): Promise<RuntimeStatus> {
  if (runtimeStarted) {
    return getRuntimeStatus();
  }

  runtimeStarted = true;

  const apiEnabled = config.api?.enabled ?? true;
  const consoleEnabled = config.console?.enabled ?? true;

  let apiPort = 0;
  let consolePort = 0;

  // Start API server (default port 4096)
  if (apiEnabled) {
    try {
      apiPort = await startApiServer({
        store: config.store,
        host: config.api?.host,
        port: config.api?.port,
      });
    } catch (err) {
      // API server failed to start — non-fatal
    }
  }

  // Start Console static server (default port 517)
  if (consoleEnabled) {
    try {
      consolePort = await startConsoleServer({
        host: config.console?.host,
        port: config.console?.port,
      });
    } catch (err) {
      // Console server failed to start — non-fatal
    }
  }

  return { api: { running: apiPort > 0, port: apiPort }, console: { running: consolePort > 0, port: consolePort } };
}

export async function stopRuntime(): Promise<void> {
  await stopApiServer();
  await stopConsoleServer();
  runtimeStarted = false;
}

export function getRuntimeStatus(): RuntimeStatus {
  return {
    api: { running: false, port: 0 },
    console: { running: false, port: 0 },
  };
}