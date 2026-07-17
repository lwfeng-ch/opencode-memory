import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { LLMTraceLogger, type LLMTraceEntry } from "../../benchmark/trace.js"

describe("LLMTraceLogger", () => {
  let tmpDir: string
  let traceFile: string
  let logger: LLMTraceLogger

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trace-test-"))
    traceFile = join(tmpDir, "llm-trace.jsonl")
    logger = new LLMTraceLogger(traceFile)
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const entry1: LLMTraceEntry = {
    requestId: "req-001",
    model: "qwen3-14b",
    caseId: "golden-extract-001",
    repeatIndex: 1,
    latencyMs: 2300,
    tokens: { input: 850, output: 350 },
    cacheHit: false,
    timestamp: "2026-07-16T14:30:00.000Z",
  }

  const entry2: LLMTraceEntry = {
    requestId: "req-002",
    model: "gpt-4o",
    caseId: "golden-extract-001",
    repeatIndex: 2,
    latencyMs: 1800,
    tokens: { input: 850, output: 400 },
    cacheHit: true,
    timestamp: "2026-07-16T14:30:01.000Z",
  }

  const entry3: LLMTraceEntry = {
    requestId: "req-003",
    model: "qwen3-14b",
    caseId: "golden-recall-001",
    repeatIndex: 1,
    latencyMs: 1500,
    tokens: { input: 600, output: 200 },
    cacheHit: false,
    timestamp: "2026-07-16T14:35:00.000Z",
  }

  test("log a single entry", async () => {
    await logger.log(entry1)
    const results = await logger.query({})
    expect(results.length).toBe(1)
    expect(results[0].requestId).toBe("req-001")
  })

  test("log multiple entries", async () => {
    await logger.log(entry2)
    await logger.log(entry3)
    const results = await logger.query({})
    expect(results.length).toBe(3)
  })

  test("query by model", async () => {
    const results = await logger.query({ model: "qwen3-14b" })
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.model).toBe("qwen3-14b")
    }
  })

  test("query by caseId", async () => {
    const results = await logger.query({
      caseId: "golden-extract-001",
    })
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.caseId).toBe("golden-extract-001")
    }
  })

  test("query by model and caseId combined", async () => {
    const results = await logger.query({
      model: "gpt-4o",
      caseId: "golden-extract-001",
    })
    expect(results.length).toBe(1)
    expect(results[0].requestId).toBe("req-002")
  })

  test("query with non-matching filter returns empty", async () => {
    const results = await logger.query({
      model: "nonexistent-model",
    })
    expect(results.length).toBe(0)
  })

  test("entry fields are preserved", async () => {
    const results = await logger.query({ requestId: "req-001" } as any)
    // Filter manually since query only supports model/caseId
    const match = (await logger.query({})).find(
      (e) => e.requestId === "req-001",
    )
    expect(match).toBeDefined()
    expect(match?.latencyMs).toBe(2300)
    expect(match?.tokens).toEqual({ input: 850, output: 350 })
    expect(match?.cacheHit).toBe(false)
    expect(match?.repeatIndex).toBe(1)
  })
})

describe("LLMTraceLogger - empty file", () => {
  test("query on non-existent file returns empty array", async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), "trace-empty-"))
    const logger = new LLMTraceLogger(join(tmpDir2, "nonexistent.jsonl"))
    const results = await logger.query({})
    expect(results).toEqual([])
    rmSync(tmpDir2, { recursive: true, force: true })
  })
})
