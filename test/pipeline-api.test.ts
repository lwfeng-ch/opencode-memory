import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createStore } from "../src/store.js";
import { startMemoryServer, stopMemoryServer } from "../src/server/index.js";

describe("Pipeline API", () => {
  let tmpDir: string;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pipeline-api-test-"));
    const store = await createStore(tmpDir, { maxFiles: 200, frontmatterMaxLines: 30 });
    port = await startMemoryServer({ store, memoryDir: tmpDir, port: 0 });
  });

  afterAll(async () => {
    await stopMemoryServer();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/v1/pipeline/sessions returns sessions", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/pipeline/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(body.sessions.length).toBeGreaterThan(0);
    expect(body.sessions[0].stages).toBeDefined();
  });

  it("GET /api/v1/pipeline/sessions/:id returns detail", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/pipeline/sessions/ses_001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stages[0].detail).toBeDefined();
  });

  it("GET /api/v1/pipeline/status returns pipeline status", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/pipeline/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capture).toBeDefined();
    expect(body.dream).toBeDefined();
    expect(body.governance).toBeDefined();
  });
});