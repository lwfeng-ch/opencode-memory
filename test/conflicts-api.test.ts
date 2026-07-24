import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createStore } from "../src/store.js";
import { startMemoryServer, stopMemoryServer } from "../src/server/index.js";

describe("Conflicts API", () => {
  let tmpDir: string;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "conflicts-api-test-"));
    const store = await createStore(tmpDir, { maxFiles: 200, frontmatterMaxLines: 30 });
    port = await startMemoryServer({ store, memoryDir: tmpDir, port: 0 });
  });

  afterAll(async () => {
    await stopMemoryServer();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/v1/conflicts returns list", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/conflicts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty("claimA");
    expect(body[0]).toHaveProperty("claimB");
    expect(body[0]).toHaveProperty("resolution");
  });

  it("GET /api/v1/conflicts/:id returns detail", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/conflicts/c1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeline).toBeDefined();
  });

  it("POST /api/v1/conflicts/:id/resolve resolves", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/conflicts/c1/resolve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("resolved");
  });
});
