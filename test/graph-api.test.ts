import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createStore } from "../src/store.js";
import {
  startMemoryServer,
  stopMemoryServer,
} from "../src/server/index.js";

describe("Graph API", () => {
  let tmpDir: string;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "graph-api-test-"));
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

  it("GET /api/v1/graph returns nodes and edges", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/graph`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toBeDefined();
    expect(body.edges).toBeDefined();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
    const types = body.nodes.map((n: { type: string }) => n.type);
    expect(types).toContain("fact");
    expect(types).toContain("conflict");
    expect(types).toContain("proposal");
  });

  it("GET /api/v1/graph/memory/:id returns subgraph", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/graph/memory/m1`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toBeDefined();
    expect(body.edges).toBeDefined();
    expect(body.nodes.some((n: { type: string }) => n.type === "execution")).toBe(
      true,
    );
  });
});