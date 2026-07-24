import { Hono } from "hono";
import type { MemoryStore } from "../../store.js";
import { scanMemoryFiles } from "../../scan.js";
import type { MemoryHeader } from "../../config.js";
import type {
  ApiMemoryListResponse,
  ApiMemoryDetailResponse,
  ApiMemoryHistoryResponse,
} from "../types.js";

export function createMemoriesRoutes(store: MemoryStore): Hono {
  const app = new Hono();

  // GET /api/v1/memories — list with pagination + filtering
  app.get("/", async (c) => {
    const page = parseInt(c.req.query("page") ?? "1", 10);
    const pageSize = Math.min(
      parseInt(c.req.query("pageSize") ?? "50", 10),
      200,
    );
    const scope = c.req.query("scope");
    const type = c.req.query("type");
    const status = c.req.query("status");
    const search = c.req.query("search")?.toLowerCase();

    const allHeaders = await scanMemoryFiles(store);

    let filtered = allHeaders;
    if (scope)
      filtered = filtered.filter((h) => h.scope === scope);
    if (type)
      filtered = filtered.filter((h) => h.type === type);
    if (status)
      filtered = filtered.filter(
        (h) => (h as MemoryHeader & { status?: string }).status === status,
      );
    if (search) {
      filtered = filtered.filter(
        (h) =>
          h.filename?.toLowerCase().includes(search) ||
          h.description?.toLowerCase().includes(search),
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const memories = filtered.slice(start, start + pageSize);

    const response: ApiMemoryListResponse = {
      memories,
      total,
      page,
      pageSize,
    };
    return c.json(response);
  });

  // GET /api/v1/memories/:id — single memory detail
  app.get("/:id", async (c) => {
    const filename = c.req.param("id");
    const exists = await store.exists(filename);
    if (!exists) {
      return c.json({ error: "Memory not found", code: "NOT_FOUND" }, 404);
    }

    const content = await store.read(filename);
    const allHeaders = await scanMemoryFiles(store);
    const header = allHeaders.find((h) => h.filename === filename);

    if (!header) {
      return c.json({ error: "Memory not found", code: "NOT_FOUND" }, 404);
    }

    // Parse frontmatter from content
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter: Record<string, unknown> = {};
    let body = content;
    if (frontmatterMatch) {
      const raw = frontmatterMatch[1];
      for (const line of raw.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim();
          frontmatter[key] = value;
        }
      }
      body = content.slice(frontmatterMatch[0].length);
    }

    const response: ApiMemoryDetailResponse = {
      filename: header.filename,
      name: (frontmatter["name"] as string) ?? header.filename,
      description: header.description ?? "",
      type: header.type ?? "",
      scope: header.scope ?? "",
      confidence: header.confidence ?? "inferred",
      status:
        (header as MemoryHeader & { status?: string }).status ?? "active",
      content: body,
      provenance: (frontmatter["provenance"] as Record<string, unknown>) ?? {},
      mtimeMs: header.mtimeMs,
      recallCount: header.recallCount,
      lastRecalledAt: header.lastRecalledAt,
    };
    return c.json(response);
  });

  // GET /api/v1/memories/:id/history — lifecycle events
  app.get("/:id/history", async (c) => {
    const filename = c.req.param("id");
    const exists = await store.exists(filename);
    if (!exists) {
      return c.json({ error: "Memory not found", code: "NOT_FOUND" }, 404);
    }

    const content = await store.read(filename);
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    let events: Array<{
      action: string;
      timestamp: number;
      actor: string;
      detail?: string;
    }> = [];

    if (frontmatterMatch) {
      const raw = frontmatterMatch[1];
      for (const line of raw.split("\n")) {
        if (line.startsWith("provenance:")) {
          const provenanceStr = line.slice("provenance:".length).trim();
          try {
            const provenance = JSON.parse(provenanceStr);
            if (provenance.history) {
              events = provenance.history.map(
                (e: {
                  action: string;
                  timestamp: number;
                  actor: string;
                  detail?: string;
                }) => ({
                  action: e.action,
                  timestamp: e.timestamp,
                  actor: e.actor,
                  detail: e.detail,
                }),
              );
            }
          } catch {
            // not JSON — skip
          }
        }
      }
    }

    const response: ApiMemoryHistoryResponse = { events };
    return c.json(response);
  });

  return app;
}
