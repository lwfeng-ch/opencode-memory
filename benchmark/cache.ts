/**
 * opencode-memory — Benchmark Cache
 *
 * Generic cache abstraction for benchmark results across suites.
 * Supports file-based caching and no-op mode.
 */

import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { mkdir, rm } from "node:fs/promises"

// ---------------------------------------------------------------------------
// Cache interface + implementations
// ---------------------------------------------------------------------------

/** Cache for benchmark results. Generic across suites (extraction, recall, dream). */
export interface BenchmarkCache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  /** Clear cache for a specific suite + model (manual cleanup) */
  clear(suite?: string, model?: string): Promise<void>
  /** Stats for reporting */
  stats(): { hits: number; misses: number; entries: number }
}

/** No-op cache — disables caching entirely. */
export class NoopCache implements BenchmarkCache {
  async get<T>(): Promise<T | null> {
    return null
  }
  async set<T>(): Promise<void> {
    /* no-op */
  }
  async clear(): Promise<void> {
    /* no-op */
  }
  stats() {
    return { hits: 0, misses: 0, entries: 0 }
  }
}

/** File-based cache. One JSON file per cache key. */
export class FileBenchmarkCache implements BenchmarkCache {
  private hitCount = 0
  private missCount = 0

  constructor(private cacheDir: string = "benchmark/cache") {}

  async get<T>(key: string): Promise<T | null> {
    const path = this.pathFor(key)
    try {
      const data = await Bun.file(path).text()
      this.hitCount++
      return JSON.parse(data) as T
    } catch {
      this.missCount++
      return null
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const path = this.pathFor(key)
    const dir = dirname(path)
    try {
      await mkdir(dir, { recursive: true })
    } catch {
      // Directory may already exist
    }
    await Bun.write(path, JSON.stringify(value, null, 2))
  }

  async clear(suite?: string, model?: string): Promise<void> {
    let dir = this.cacheDir
    if (suite) dir = join(dir, suite)
    if (model) dir = join(dir, model)
    await rm(dir, { recursive: true, force: true })
  }

  stats() {
    return { hits: this.hitCount, misses: this.missCount, entries: -1 }
  }

  private pathFor(key: string): string {
    // Key format: "<suite>/<model>/<hash>" — computed by computeCacheKey
    return join(this.cacheDir, `${key}.json`)
  }
}

// ---------------------------------------------------------------------------
// Cache key computation
// ---------------------------------------------------------------------------

/** Input for cache key computation. Includes everything that affects LLM output. */
export interface CacheKeyInput {
  pipeline: {
    version: string
    promptVersion: string
    config: Record<string, unknown>
  }
  model: {
    name: string
    temperature: number
    topP?: number
    topK?: number
    maxTokens?: number
    seed?: number
  }
  runtime: {
    gitCommit: string
    packageVersion: string
  }
  caseId: string
  suite: string
  /** CRITICAL: Without this, repeat=3 hits same cache entry */
  repeatIndex: number
}

/**
 * Compute a cache key from the full input context.
 *
 * Returns "<suite>/<model>/<hash>" — the FileBenchmarkCache appends ".json".
 * repeatIndex is included in the hash to ensure each repeat gets a unique
 * cache entry, allowing repeat=3 to produce 3 distinct LLM calls.
 */
export function computeCacheKey(input: CacheKeyInput): string {
  const json = JSON.stringify({
    s: input.pipeline.config,
    pv: input.pipeline.promptVersion,
    m: input.model,
    rt: { gc: input.runtime.gitCommit, pv: input.runtime.packageVersion },
    ci: input.caseId,
    ri: input.repeatIndex,
  })
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16)
  return `${input.suite}/${input.model.name}/${hash}`
}
