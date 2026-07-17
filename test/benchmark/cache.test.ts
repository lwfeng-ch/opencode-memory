import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  NoopCache,
  FileBenchmarkCache,
  computeCacheKey,
  type CacheKeyInput,
} from "../../benchmark/cache.js"

describe("NoopCache", () => {
  const cache = new NoopCache()

  test("get returns null", async () => {
    const result = await cache.get("any-key")
    expect(result).toBeNull()
  })

  test("set does not throw", async () => {
    await expect(cache.set("key", { data: 123 })).resolves.toBeUndefined()
  })

  test("clear does not throw", async () => {
    await expect(cache.clear()).resolves.toBeUndefined()
    await expect(cache.clear("suite")).resolves.toBeUndefined()
    await expect(cache.clear("suite", "model")).resolves.toBeUndefined()
  })

  test("stats returns zeros", () => {
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, entries: 0 })
  })
})

describe("FileBenchmarkCache", () => {
  let tmpDir: string
  let cache: FileBenchmarkCache

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cache-test-"))
    cache = new FileBenchmarkCache(tmpDir)
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("write and read a value", async () => {
    const key = "test_suite/test_model/a1b2c3d4e5f6g7h8"
    const value = { score: 0.95, name: "test-result" }
    await cache.set(key, value)
    const result = await cache.get<typeof value>(key)
    expect(result).toEqual(value)
  })

  test("cache miss returns null", async () => {
    const result = await cache.get("nonexistent/suite/missing1234")
    expect(result).toBeNull()
  })

  test("stats tracks hits and misses", async () => {
    const freshCache = new FileBenchmarkCache(tmpDir + "-stats")
    expect(freshCache.stats()).toEqual({ hits: 0, misses: 0, entries: -1 })

    await freshCache.get("some/key/miss")
    expect(freshCache.stats()).toEqual({ hits: 0, misses: 1, entries: -1 })

    const key = "stats_suite/stats_model/hitkey1234"
    await freshCache.set(key, { ok: true })
    await freshCache.get(key)
    expect(freshCache.stats()).toEqual({ hits: 1, misses: 1, entries: -1 })

    // Cleanup
    rmSync(tmpDir + "-stats", { recursive: true, force: true })
  })

  test("clear by suite removes only that suite", async () => {
    const suiteDir = tmpDir + "-clear-suite"
    const c = new FileBenchmarkCache(suiteDir)
    await c.set("suite_a/model_x/hash1", { a: 1 })
    await c.set("suite_b/model_x/hash2", { b: 1 })

    await c.clear("suite_a")

    // suite_a files should be gone, suite_b should remain
    const aVal = await c.get("suite_a/model_x/hash1")
    expect(aVal).toBeNull()
    const bVal = await c.get("suite_b/model_x/hash2")
    expect(bVal).toEqual({ b: 1 })

    rmSync(suiteDir, { recursive: true, force: true })
  })

  test("clear by suite and model removes only that model", async () => {
    const modelDir = tmpDir + "-clear-model"
    const c = new FileBenchmarkCache(modelDir)
    await c.set("suite/model_a/hash1", { a: 1 })
    await c.set("suite/model_b/hash2", { b: 1 })

    await c.clear("suite", "model_a")

    const aVal = await c.get("suite/model_a/hash1")
    expect(aVal).toBeNull()
    const bVal = await c.get("suite/model_b/hash2")
    expect(bVal).toEqual({ b: 1 })

    rmSync(modelDir, { recursive: true, force: true })
  })

  test("clear all removes everything", async () => {
    const allDir = tmpDir + "-clear-all"
    const c = new FileBenchmarkCache(allDir)
    await c.set("suite_a/model_x/h1", { a: 1 })
    await c.set("suite_b/model_y/h2", { b: 2 })

    await c.clear()

    expect(await c.get("suite_a/model_x/h1")).toBeNull()
    expect(await c.get("suite_b/model_y/h2")).toBeNull()
    rmSync(allDir, { recursive: true, force: true })
  })

  test("overwrite existing key", async () => {
    const overwriteDir = tmpDir + "-overwrite"
    const c = new FileBenchmarkCache(overwriteDir)
    const key = "suite/model/hash_overwrite"

    await c.set(key, { version: 1 })
    await c.set(key, { version: 2 })

    const result = await c.get<{ version: number }>(key)
    expect(result?.version).toBe(2)

    rmSync(overwriteDir, { recursive: true, force: true })
  })
})

describe("computeCacheKey", () => {
  const baseInput: CacheKeyInput = {
    pipeline: {
      version: "0.3.2",
      promptVersion: "extract-v4",
      config: {
        maxMemories: 10,
        confidenceThreshold: 0.5,
        enableValidation: true,
        enableFingerprint: true,
        fingerprintThreshold: 0.8,
        promotionMode: "auto",
      },
    },
    model: {
      name: "qwen3-14b",
      temperature: 0,
      topP: 0.8,
      maxTokens: 2000,
    },
    runtime: {
      gitCommit: "abc1234",
      packageVersion: "0.3.2",
    },
    caseId: "golden-extract-001",
    suite: "extraction_pipeline",
    repeatIndex: 1,
  }

  test("returns key in suite/model/hash format", () => {
    const key = computeCacheKey(baseInput)
    expect(key).toMatch(/^extraction_pipeline\/qwen3-14b\/[a-f0-9]{16}$/)
  })

  test("different repeatIndex produces different keys", () => {
    const key1 = computeCacheKey({ ...baseInput, repeatIndex: 1 })
    const key2 = computeCacheKey({ ...baseInput, repeatIndex: 2 })
    expect(key1).not.toBe(key2)
  })

  test("same input produces same key (deterministic)", () => {
    const key1 = computeCacheKey(baseInput)
    const key2 = computeCacheKey({ ...baseInput })
    expect(key1).toBe(key2)
  })

  test("different caseId produces different keys", () => {
    const key1 = computeCacheKey(baseInput)
    const key2 = computeCacheKey({ ...baseInput, caseId: "golden-extract-002" })
    expect(key1).not.toBe(key2)
  })

  test("different model produces different keys", () => {
    const key1 = computeCacheKey(baseInput)
    const key2 = computeCacheKey({
      ...baseInput,
      model: { ...baseInput.model, name: "gpt-4o" },
    })
    expect(key1).not.toBe(key2)
  })

  test("different pipeline config produces different keys", () => {
    const key1 = computeCacheKey(baseInput)
    const key2 = computeCacheKey({
      ...baseInput,
      pipeline: {
        ...baseInput.pipeline,
        config: { ...baseInput.pipeline.config, maxMemories: 20 },
      },
    })
    expect(key1).not.toBe(key2)
  })

  test("hash is 16 hex characters", () => {
    const key = computeCacheKey(baseInput)
    const hash = key.split("/").pop()!
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
    expect(hash.length).toBe(16)
  })
})
