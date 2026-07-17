/**
 * opencode-memory — Benchmark Config Loader (v0.3.2)
 *
 * Separate config from memory.config.json — benchmark config has a different
 * lifecycle (model, temperature, cache settings for evaluation only).
 *
 * Features:
 *   - Load from JSON/JSONC file with env var substitution
 *   - Graceful defaults when file is missing
 *   - Strips JSONC comments (single-line and multi-line) before parsing
 */

import { readFileSync } from "node:fs"
import { existsSync } from "node:fs"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkConfig {
  completion: {
    provider: string
    model: string
    temperature: number
    topP?: number
    maxTokens?: number
    apiKey: string
  }
  embedding?: {
    provider: string
    model: string
    dimensions: number
    apiKey: string
  }
  cache: {
    enabled: boolean
    dir: string
  }
  repeat: Record<string, number>
}

// ---------------------------------------------------------------------------
// Default repeat policies (mirrors Section 4's DEFAULT_REPEAT_POLICIES)
// ---------------------------------------------------------------------------

const DEFAULT_REPEAT_POLICIES: Record<string, number> = {
  extraction_pipeline: 3,
  recall: 1,
  dedup: 3,
  conflict: 3,
  forgetting: 1,
}

// ---------------------------------------------------------------------------
// Default config (used when file is missing)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BenchmarkConfig = {
  completion: {
    provider: "qwen",
    model: "qwen3-14b",
    temperature: 0,
    apiKey: "",
  },
  cache: {
    enabled: true,
    dir: "benchmark/cache",
  },
  repeat: { ...DEFAULT_REPEAT_POLICIES },
}

// ---------------------------------------------------------------------------
// JSONC comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip JSONC-style comments from a string before JSON.parse.
 * Handles single-line (//) and multi-line comments.
 * String-aware: does NOT strip // inside quoted strings (e.g. URLs).
 */
export function stripJsoncComments(text: string): string {
  let result = ""
  let i = 0
  let inString = false
  let escape = false

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

    if (escape) {
      // Previous char was backslash — this char is escaped, copy literally
      result += ch
      escape = false
      i++
      continue
    }

    if (ch === "\\" && inString) {
      // Backslash inside string — escape next char
      result += ch
      escape = true
      i++
      continue
    }

    if (ch === '"') {
      inString = !inString
      result += ch
      i++
      continue
    }

    if (!inString && ch === "/" && next === "/") {
      // Single-line comment — skip to end of line
      while (i < text.length && text[i] !== "\n") i++
      continue
    }

    if (!inString && ch === "/" && next === "*") {
      // Multi-line comment — skip to closing */
      i += 2
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }

    result += ch
    i++
  }

  return result
}

// ---------------------------------------------------------------------------
// Environment variable substitution
// ---------------------------------------------------------------------------

/**
 * Recursively walk an object tree and replace $VAR_NAME patterns in
 * string values with process.env[VAR_NAME].
 *
 * Only processes actual string leaf values — does NOT touch keys,
 * numbers, booleans, or nested objects/arrays as values.
 */
export function substituteEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match, varName: string) => {
      return process.env[varName] ?? ""
    })
  }
  if (Array.isArray(value)) {
    return value.map(substituteEnvVars)
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = substituteEnvVars(v)
    }
    return result
  }
  return value
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

/**
 * Load benchmark config from a JSON/JSONC file.
 *
 * Resolution order:
 *   1. If path is provided, use that path
 *   2. If path is omitted, try "benchmark.config.json" in cwd
 *   3. If file doesn't exist, return factory defaults
 *
 * The file is processed through JSONC comment stripping and env var
 * substitution before being cast to BenchmarkConfig.
 *
 * @param path - Optional path to benchmark config file
 * @returns Parsed and substituted BenchmarkConfig
 */
export function loadBenchmarkConfig(path?: string): BenchmarkConfig {
  const filePath = path ?? "benchmark.config.json"

  if (!existsSync(filePath)) {
    return { ...DEFAULT_CONFIG, repeat: { ...DEFAULT_REPEAT_POLICIES } }
  }

  try {
    const raw = readFileSync(filePath, "utf-8")
    const cleaned = stripJsoncComments(raw)
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const substituted = substituteEnvVars(parsed) as Record<string, unknown>

    // Merge with defaults to ensure all fields present
    const completion = (substituted.completion as Record<string, unknown>) ?? {}
    const cache = (substituted.cache as Record<string, unknown>) ?? {}
    const repeat = (substituted.repeat as Record<string, unknown>) ?? {}

    return {
      completion: {
        provider: (completion.provider as string) ?? DEFAULT_CONFIG.completion.provider,
        model: (completion.model as string) ?? DEFAULT_CONFIG.completion.model,
        temperature: (completion.temperature as number) ?? DEFAULT_CONFIG.completion.temperature,
        apiKey: (completion.apiKey as string) ?? DEFAULT_CONFIG.completion.apiKey,
        topP: completion.topP as number | undefined,
        maxTokens: completion.maxTokens as number | undefined,
      },
      embedding: substituted.embedding
        ? {
            provider: (substituted.embedding as Record<string, unknown>).provider as string,
            model: (substituted.embedding as Record<string, unknown>).model as string,
            dimensions: (substituted.embedding as Record<string, unknown>).dimensions as number,
            apiKey: (substituted.embedding as Record<string, unknown>).apiKey as string,
          }
        : undefined,
      cache: {
        enabled: (cache.enabled as boolean) ?? DEFAULT_CONFIG.cache.enabled,
        dir: (cache.dir as string) ?? DEFAULT_CONFIG.cache.dir,
      },
      repeat: {
        ...DEFAULT_REPEAT_POLICIES,
        ...Object.fromEntries(
          Object.entries(repeat).map(([k, v]) => [k, Number(v)]),
        ) as Record<string, number>,
      },
    }
  } catch {
    // On parse error, return defaults
    return { ...DEFAULT_CONFIG, repeat: { ...DEFAULT_REPEAT_POLICIES } }
  }
}
