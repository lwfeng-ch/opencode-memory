/**
 * opencode-memory — Console Static Server
 *
 * Serves the built Memory Governance Console static files on port 517.
 * The console is built from memory-console/ and served as static HTML.
 * No logs, no browser opening — silently available at http://127.0.0.1:517
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CONSOLE_OUT_DIR = join(__dirname, "memory-console", "out");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

let server: ReturnType<typeof createServer> | null = null;
let currentPort = 0;

export interface ConsoleServerConfig {
  host?: string;
  port?: number;
  consoleDir?: string;
}

export async function startConsoleServer(config: ConsoleServerConfig = {}): Promise<number> {
  if (server) return currentPort;

  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 517;
  const consoleDir = config.consoleDir ?? CONSOLE_OUT_DIR;

  server = createServer(async (req, res) => {
    let urlPath = (req.url ?? "/").split("?")[0]; // strip query string
    if (urlPath === "/") urlPath = "/index.html";

    // Try exact path first, then with .html extension, then directory/index.html
    const candidates = [
      join(consoleDir, urlPath),
      join(consoleDir, urlPath + ".html"),
      join(consoleDir, urlPath, "index.html"),
    ];

    let served = false;
    for (const filePath of candidates) {
      try {
        const s = await stat(filePath);
        if (!s.isFile()) continue;
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
        const content = await readFile(filePath);
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(content);
        served = true;
        break;
      } catch {
        // try next candidate
      }
    }

    if (!served) {
      // SPA fallback: serve index.html for client-side routing
      try {
        const indexContent = await readFile(join(consoleDir, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(indexContent);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    }
  });

  return new Promise((resolve, reject) => {
    server!.listen(port, host, () => {
      currentPort = port;
      resolve(port);
    });
    server!.once("error", reject);
  });
}

export async function stopConsoleServer(): Promise<void> {
  if (!server) return;
  return new Promise((resolve) => {
    server!.close(() => {
      server = null;
      currentPort = 0;
      resolve();
    });
  });
}

export function getConsolePort(): number {
  return currentPort;
}