/**
 * opencode-memory — Runtime Health Check
 *
 * Port availability detection and runtime status checks.
 * Prevents duplicate server starts on plugin reload.
 */

import { createServer } from "node:net";

/** Check if a port is available (not in use). */
export function isPortAvailable(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, host);
  });
}

/** Check if a port is already serving (in use by our process). */
export function isPortListening(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const client = createServer();
    client.once("error", () => resolve(false));
    client.once("listening", () => {
      client.close();
      resolve(true);
    });
    client.listen(port, host);
  });
}