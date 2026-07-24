import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createStore } from "../src/store.js";
import {
  startMemoryServer,
  stopMemoryServer,
} from "../src/server/index.js";

describe("Governance API", () => {
  let tmpDir: string;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(
      join(tmpdir(), "governance-api-test-"),
    );
    const store = await createStore(tmpDir, {
      maxFiles: 200,
      frontmatterMaxLines: 30,
    });
    port = await startMemoryServer({
      store,
      memoryDir: tmpDir,
      port: 0,
    });
  });

  afterAll(async () => {
    await stopMemoryServer();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/v1/governance/proposals returns proposals", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/governance/proposals`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty("id");
    expect(body[0]).toHaveProperty("riskFactors");
    expect(body[0]).toHaveProperty("aiExplanation");
    expect(body[0]).toHaveProperty("createdBy");
  });

  it("POST approve proposal", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/governance/proposals/p001/approve`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("approved");
  });

  it("POST reject proposal", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/governance/proposals/p001/reject`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("rejected");
  });

  it("GET /api/v1/audit/events returns audit events", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/audit/events`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);
    expect(
      body.events.some(
        (e: { snapshotHash: unknown }) =>
          e.snapshotHash !== undefined,
      ),
    ).toBe(true);
  });

  it("GET /api/v1/events returns SSE stream", async () => {
    const ac = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/events`,
      { signal: ac.signal },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    ac.abort();
  });
});
