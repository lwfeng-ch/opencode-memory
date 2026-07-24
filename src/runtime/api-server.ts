/**
 * opencode-memory — API Server
 *
 * Wraps the existing Hono server with a dedicated port (4096).
 * Manages lifecycle: start, stop, health check.
 */

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { MemoryStore } from "../store.js";
import { createMemoriesRoutes } from "../server/routes/memories.js";
import { registerGovernanceRoutes } from "../server/routes/governance.js";
import { graphRoutes } from "../server/routes/graph.js";
import { conflictRoutes } from "../server/routes/conflicts.js";
import { pipelineRoutes } from "../server/routes/pipeline.js";
import { Hono } from "hono";

let server: ServerType | null = null;
let currentPort = 0;

export interface ApiServerConfig {
  store: MemoryStore;
  host?: string;
  port?: number;
}

export async function startApiServer(config: ApiServerConfig): Promise<number> {
  if (server) return currentPort;

  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 4096;

  const app = new Hono();

  // CORS for console
  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // Health
  app.get("/api/v1/health", async (c) => {
    const allHeaders = await config.store.list();
    return c.json({
      status: "ok",
      uptime: process.uptime(),
      memoryCount: allHeaders.length,
      pipelineStatus: { capture: "running", extraction: "healthy", dream: "idle", governance: "ready" },
    });
  });

  // Routes
  app.route("/api/v1/memories", createMemoriesRoutes(config.store));
  app.route("/api/v1/graph", graphRoutes);
  app.route("/api/v1/conflicts", conflictRoutes);
  app.route("/api/v1/pipeline", pipelineRoutes);
  registerGovernanceRoutes(app);

  return new Promise((resolve) => {
    const s = serve(
      { fetch: app.fetch, port, hostname: host },
      (info) => {
        server = s as unknown as ServerType;
        currentPort = info.port;
        resolve(info.port);
      },
    );
  });
}

export async function stopApiServer(): Promise<void> {
  if (!server) return;
  return new Promise((resolve) => {
    server!.close(() => {
      server = null;
      currentPort = 0;
      resolve();
    });
  });
}

export function getApiPort(): number {
  return currentPort;
}