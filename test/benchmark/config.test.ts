/**
 * opencode-memory — Benchmark Config Tests (v0.3.2)
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { loadBenchmarkConfig, stripJsoncComments, substituteEnvVars } from "../../benchmark/config.js"
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"

const TEST_DIR = join(tmpdir(), "opencode-memory-benchmark-config-test")

function randomId(): string {
  return randomBytes(4).toString("hex")
}

describe("loadBenchmarkConfig", () => {
  const testDir = join(TEST_DIR, randomId())

  beforeEach(() => {
    // Create clean test dir before each test
    try { mkdirSync(testDir, { recursive: true }) } catch {}
    // Clean up any previous test files
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    try { mkdirSync(testDir, { recursive: true }) } catch {}
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("returns defaults when file does not exist", () => {
    const config = loadBenchmarkConfig(join(testDir, "nonexistent.json"))
    expect(config.completion.provider).toBe("qwen")
    expect(config.completion.model).toBe("qwen3-14b")
    expect(config.completion.temperature).toBe(0)
    expect(config.completion.apiKey).toBe("")
    expect(config.cache.enabled).toBe(true)
    expect(config.cache.dir).toBe("benchmark/cache")
    expect(config.repeat.extraction_pipeline).toBe(3)
    expect(config.repeat.recall).toBe(1)
    expect(config.repeat.dedup).toBe(3)
    expect(config.repeat.conflict).toBe(3)
    expect(config.repeat.forgetting).toBe(1)
    // embedding should be undefined in defaults
    expect(config.embedding).toBeUndefined()
  })

  test("reads config from custom path", () => {
    const filePath = join(testDir, "custom-config.json")
    const data = JSON.stringify({
      completion: {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.5,
        apiKey: "test-key-123",
      },
      cache: {
        enabled: false,
        dir: "/tmp/cache",
      },
      repeat: {
        extraction_pipeline: 5,
      },
    })
    writeFileSync(filePath, data, "utf-8")

    const config = loadBenchmarkConfig(filePath)
    expect(config.completion.provider).toBe("openai")
    expect(config.completion.model).toBe("gpt-4o")
    expect(config.completion.temperature).toBe(0.5)
    expect(config.completion.apiKey).toBe("test-key-123")
    expect(config.cache.enabled).toBe(false)
    expect(config.cache.dir).toBe("/tmp/cache")
    // Overridden repeat value
    expect(config.repeat.extraction_pipeline).toBe(5)
    // Non-overridden repeat values keep defaults
    expect(config.repeat.dedup).toBe(3)
    expect(config.repeat.recall).toBe(1)
  })

  test("substitutes env vars in config values", () => {
    const filePath = join(testDir, `env-config-${randomId()}.json`)
    const originalApiKey = process.env.TEST_BENCHMARK_API_KEY
    process.env.TEST_BENCHMARK_API_KEY = "env-key-456"

    try {
      const data = JSON.stringify({
        completion: {
          provider: "qwen",
          model: "qwen3-14b",
          temperature: 0,
          apiKey: "$TEST_BENCHMARK_API_KEY",
        },
        cache: {
          enabled: true,
          dir: "benchmark/cache",
        },
        repeat: {},
      })
      writeFileSync(filePath, data, "utf-8")

      const config = loadBenchmarkConfig(filePath)
      expect(config.completion.apiKey).toBe("env-key-456")
    } finally {
      if (originalApiKey !== undefined) {
        process.env.TEST_BENCHMARK_API_KEY = originalApiKey
      } else {
        delete process.env.TEST_BENCHMARK_API_KEY
      }
      try { unlinkSync(filePath) } catch {}
    }
  })

  test("strips JSONC comments", () => {
    const filePath = join(testDir, `jsonc-config-${randomId()}.json`)
    const data = [
      "{",
      '  // single-line comment',
      '  "completion": {',
      '    "provider": "ollama",',
      '    "model": "llama3",',
      '    "temperature": 0.8,',
      '    "apiKey": ""',
      "    /* multi-line",
      "       comment */",
      "  },",
      '  "cache": { "enabled": true, "dir": "cache" },',
      '  "repeat": {}',
      "}",
    ].join("\n")
    writeFileSync(filePath, data, "utf-8")

    const config = loadBenchmarkConfig(filePath)
    expect(config.completion.provider).toBe("ollama")
    expect(config.completion.model).toBe("llama3")
    expect(config.completion.temperature).toBe(0.8)
  })

  test('embedding config is undefined when not in file', () => {
    const filePath = join(testDir, `no-embedding-${randomId()}.json`)
    const data = JSON.stringify({
      completion: { provider: "qwen", model: "qwen3-14b", temperature: 0, apiKey: "" },
      cache: { enabled: true, dir: "cache" },
      repeat: {},
    })
    writeFileSync(filePath, data, "utf-8")

    const config = loadBenchmarkConfig(filePath)
    expect(config.embedding).toBeUndefined()
  })

  test('embedding config is present when in file', () => {
    const filePath = join(testDir, `with-embedding-${randomId()}.json`)
    const data = JSON.stringify({
      completion: { provider: "qwen", model: "qwen3-14b", temperature: 0, apiKey: "" },
      embedding: { provider: "qwen", model: "bge-m3", dimensions: 1024, apiKey: "" },
      cache: { enabled: true, dir: "cache" },
      repeat: {},
    })
    writeFileSync(filePath, data, "utf-8")

    const config = loadBenchmarkConfig(filePath)
    expect(config.embedding).toBeDefined()
    expect(config.embedding!.provider).toBe("qwen")
    expect(config.embedding!.model).toBe("bge-m3")
    expect(config.embedding!.dimensions).toBe(1024)
  })
})

describe("stripJsoncComments", () => {
  test("strips single-line comments", () => {
    const input = '{\n  // this is a comment\n  "key": "value"\n}'
    expect(stripJsoncComments(input)).toContain('"key": "value"')
    expect(stripJsoncComments(input)).not.toContain("//")
  })

  test("strips multi-line comments", () => {
    const input = '{\n  /* multi\n  line */\n  "key": "value"\n}'
    const result = stripJsoncComments(input)
    expect(result).toContain('"key": "value"')
    expect(result).not.toContain("/*")
    expect(result).not.toContain("*/")
  })

  test("handles text without comments", () => {
    const input = '{"key": "value"}'
    expect(stripJsoncComments(input)).toBe(input)
  })

  test("preserves URLs inside strings — // in URL is NOT stripped", () => {
    const input = '{"baseUrl": "https://api.openai.com/v1", "key": "value"}'
    const result = stripJsoncComments(input)
    expect(result).toContain("https://api.openai.com/v1")
    // Should still be valid JSON after stripping
    const parsed = JSON.parse(result)
    expect(parsed.baseUrl).toBe("https://api.openai.com/v1")
  })

  test("preserves // inside strings with escaped quotes", () => {
    const input = '{"url": "https://example.com/path?q=\\"test//ok\\"", "key": "val"}'
    const result = stripJsoncComments(input)
    const parsed = JSON.parse(result)
    expect(parsed.url).toContain("https://example.com")
  })

  test("strips comment after URL but preserves URL itself", () => {
    const input = '{\n  "url": "https://example.com",\n  // remove this comment\n  "key": "val"\n}'
    const result = stripJsoncComments(input)
    const parsed = JSON.parse(result)
    expect(parsed.url).toBe("https://example.com")
    expect(parsed.key).toBe("val")
    expect(result).not.toContain("remove this comment")
  })
})

describe("substituteEnvVars", () => {
  const originalVars: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalVars.TEST_MY_VAR = process.env.TEST_MY_VAR
    originalVars.TEST_ANOTHER = process.env.TEST_ANOTHER
    process.env.TEST_MY_VAR = "resolved-value"
    process.env.TEST_ANOTHER = "another-value"
  })

  afterEach(() => {
    if (originalVars.TEST_MY_VAR !== undefined) {
      process.env.TEST_MY_VAR = originalVars.TEST_MY_VAR
    } else {
      delete process.env.TEST_MY_VAR
    }
    if (originalVars.TEST_ANOTHER !== undefined) {
      process.env.TEST_ANOTHER = originalVars.TEST_ANOTHER
    } else {
      delete process.env.TEST_ANOTHER
    }
  })

  test("replaces $VAR_NAME with process.env value", () => {
    const result = substituteEnvVars("hello $TEST_MY_VAR world")
    expect(result).toBe("hello resolved-value world")
  })

  test("replaces multiple vars in one string", () => {
    const result = substituteEnvVars("$TEST_MY_VAR and $TEST_ANOTHER")
    expect(result).toBe("resolved-value and another-value")
  })

  test("recursively processes objects", () => {
    const obj = {
      key1: "value $TEST_MY_VAR",
      key2: {
        nested: "$TEST_ANOTHER",
      },
    }
    const result = substituteEnvVars(obj) as Record<string, unknown>
    expect(result.key1).toBe("value resolved-value")
    expect((result.key2 as Record<string, unknown>).nested).toBe("another-value")
  })

  test("replaces with empty string when env var not set", () => {
    const result = substituteEnvVars("$NONEXISTENT_VAR")
    expect(result).toBe("")
  })

  test("does not modify non-string values", () => {
    const obj = { num: 42, bool: true, arr: [1, 2] }
    const result = substituteEnvVars(obj) as Record<string, unknown>
    expect(result.num).toBe(42)
    expect(result.bool).toBe(true)
  })
})
