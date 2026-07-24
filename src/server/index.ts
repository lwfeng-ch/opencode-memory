import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { MemoryStore } from "../store.js";
import { writeFile } from "fs/promises";
import { getHttpDiscoveryPath } from "../paths.js";
import { corsMiddleware } from "./middleware/cors.js";
import { createMemoriesRoutes } from "./routes/memories.js";
import type { ServerType } from "@hono/node-server";

let serverInstance: ServerType | null = null;
let serverPort = 0;
let serverStartTime = 0;

export interface ServerConfig {
  store: MemoryStore;
  memoryDir: string;
  port?: number;
}

export async function startMemoryServer(
  config: ServerConfig,
): Promise<number> {
  if (serverInstance) return serverPort;

  const app = new Hono();

  // CORS
  app.use("*", corsMiddleware());

  // Health check
  app.get("/api/v1/health", async (c) => {
    const allHeaders = await config.store.list();
    const memoryCount = allHeaders.length;
    const uptime = Date.now() - serverStartTime;

    return c.json({
      status: "ok" as const,
      uptime,
      memoryCount,
      pipelineStatus: {
        capture: "running",
        extraction: "healthy",
        dream: "idle",
        governance: "waiting",
      },
    });
  });

  // Routes
  app.route("/api/v1/memories", createMemoriesRoutes(config.store));

  // Start server
  const port = config.port ?? 0; // 0 = random port
  serverPort = port;

  return new Promise((resolve, _reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: "127.0.0.1",
      },
      (info) => {
        serverInstance = server;
        serverPort = info.port;
        serverStartTime = Date.now();

        // Write discovery file
        const discoveryPath = getHttpDiscoveryPath(config.memoryDir);
        writeFile(
          discoveryPath,
          JSON.stringify({ port: info.port, pid: process.pid }, null, 2),
          "utf-8",
        ).catch(() => {
          // non-fatal
        });

        resolve(info.port);
      },
    );
  });
}

export async function stopMemoryServer(): Promise<void> {
  if (!serverInstance) return;
  return new Promise((resolve) => {
    serverInstance!.close(() => {
      serverInstance = null;
      serverPort = 0;
      resolve();
    });
  });
}

export function getServerPort(): number {
  return serverPort;
}
