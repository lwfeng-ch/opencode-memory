import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createStore } from "../src/store.js";
import {
  startMemoryServer,
  stopMemoryServer,
  getServerPort,
} from "../src/server/index.js";

describe("Memory HTTP Server", () => {
  let tmpDir: string;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-server-test-"));
    const store = await createStore(tmpDir, {
      maxFiles: 200,
      frontmatterMaxLines: 30,
    });
    port = await startMemoryServer({ store, memoryDir: tmpDir, port: 0 });
  });

  afterAll(async () => {
    await stopMemoryServer();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should start on a valid port", () => {
    expect(port).toBeGreaterThan(0);
  });

  it("should return health status", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.memoryCount).toBe("number");
  });

  it("should return empty memories list initially", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/memories`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.memories)).toBe(true);
    expect(body.total).toBe(0);
  });

  it("should return 404 for unknown memory", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/memories/nonexistent.md`,
    );
    expect(res.status).toBe(404);
  });
});
