/**
 * opencode-memory — Configuration
 *
 * Model-agnostic configuration for the memory pipeline.
 * Every LLM call point is independently configurable so users on free
 * models, local models, or multi-provider setups can tune each stage.
 *
 * Design principle: no hard-coded model assumptions. Every model-dependent
 * task has a fallback path that degrades gracefully.
 *
 * User config file: memory.config.json (alongside the plugin directory).
 * The file uses a flat feature-sectioned layout for readability.
 */

import { readFile } from "fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

// ---------------------------------------------------------------------------
// Shared agent client types
// ---------------------------------------------------------------------------

/** Options passed to the agent framework when creating a sub-session.
 *
 * - `agent` / `category` / `subagentType`: which agent category to use
 *   (e.g. "explore", "quick", "deep").
 * - `model`: optional model override. If omitted or null, the framework falls
 *   back to the default for the chosen agent category.
 */
export interface AgentSessionCreateOptions {
  agent?: string
  model?: string
}

// ---------------------------------------------------------------------------
// Memory type taxonomy (ported from Claude Code, kept compatible)
// ---------------------------------------------------------------------------

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== "string") return undefined
  return MEMORY_TYPES.find((t) => t === raw)
}

// ---------------------------------------------------------------------------
// Memory scope — lifecycle boundary (distinct from semantic type)
// ---------------------------------------------------------------------------

export const MEMORY_SCOPES = ["user", "project"] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export function parseMemoryScope(raw: unknown): MemoryScope | undefined {
  if (typeof raw !== "string") return undefined
  return MEMORY_SCOPES.find((s) => s === raw)
}

// ---------------------------------------------------------------------------
// Confidence — trust level (enum, not float — free models handle enums better)
// ---------------------------------------------------------------------------

export const CONFIDENCE_LEVELS = ["explicit", "inferred", "uncertain"] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export function parseConfidence(raw: unknown): ConfidenceLevel {
  if (typeof raw !== "string") return "inferred"
  return CONFIDENCE_LEVELS.find((c) => c === raw) ?? "inferred"
}

// ---------------------------------------------------------------------------
// Scope Resolver — type→scope default routing (loose binding, overridable)
// ---------------------------------------------------------------------------

/**
 * Resolve which scope a memory should be stored in.
 *
 * Type is semantic classification ("what kind of information is this?").
 * Scope is lifecycle boundary ("how long does this persist and where?").
 *
 * They are related but NOT bound — the agent can override via the `scope`
 * parameter in memory_save. This function provides the default routing.
 *
 * Routing logic (mirrors Claude Code's <scope> tags in memoryTypes.ts):
 *   user       → user scope (identity is cross-project)
 *   feedback   → user scope (preferences usually apply everywhere)
 *   project    → project scope (project context is project-specific)
 *   reference  → project scope (pointers to project resources)
 *
 * The agent should override when:
 *   - A feedback is project-specific (e.g., "this project doesn't use Redis")
 *   - A reference is cross-project (e.g., "CI dashboard at grafana.internal")
 */
export function resolveMemoryScope(
  type: MemoryType,
  explicitScope?: MemoryScope,
): MemoryScope {
  if (explicitScope) return explicitScope
  if (type === "user" || type === "feedback") return "user"
  return "project"
}

// ---------------------------------------------------------------------------
// Frontmatter contract
// ---------------------------------------------------------------------------

export interface MemoryFrontmatter {
  name: string
  description: string
  type: MemoryType
  scope?: MemoryScope
  confidence?: ConfidenceLevel
  schema_version?: number
}

export interface MemoryHeader {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
  scope: MemoryScope | undefined
  confidence: ConfidenceLevel
  schemaVersion: number | undefined
}

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

export interface MemoryPluginConfig {
  /** Enable/disable the entire memory system. */
  enabled: boolean

  /** Storage backend. Currently only "filesystem". Future: "sqlite", "mcp". */
  storage: "filesystem"

  /**
   * Recall configuration — two-stage pipeline.
   *
   * Stage 1 (rule filter): zero model calls. Keyword/type/recency scoring.
   * Stage 2 (LLM rerank): one lightweight call on Stage 1 survivors only.
   */
  recall: {
    /** Enable/disable the recall pipeline. */
    enabled: boolean
    /** Subagent type for LLM rerank stage. Reuses oh-my-openagent agents. */
    subagentType: string
    /** Run recall in background (async prefetch, non-blocking). */
    background: boolean
    /** Max candidates from Stage 1 rule filter. */
    maxCandidates: number
    /** Max memories returned after Stage 2 LLM rerank. */
    maxResults: number
    /** Max tokens for the LLM rerank call. */
    maxTokens: number
    /** Min query length to trigger recall (skip "ok", "continue"). */
    minQueryLength: number
    /** Disable LLM rerank entirely — rule filter only (weakest-model mode). */
    llmRerankDisabled: boolean
  }

  /**
   * Extraction configuration — KAIROS mode.
   *
   * Main agent appends to daily logs; extraction runs on session.idle.
   */
  extraction: {
    /** Enable/disable the KAIROS extraction pipeline. */
    enabled: boolean
    /** Category for the extraction subagent. Reuses oh-my-openagent. */
    category: string
    /** Min context tokens before first extraction. */
    minTokensToInit: number
    /** Min token growth between extractions. */
    minTokensBetweenUpdate: number
    /** Max tokens per section in session memory file. */
    maxSectionLength: number
    /** Max total tokens in session memory file. */
    maxTotalTokens: number
  }

  /**
   * Dream consolidation — periodic memory maintenance.
   *
   * Four-phase pipeline: Orient → Gather → Consolidate → Prune.
   * Runs when three gates pass (cheapest-first).
   */
   dream: {
    /** Category for the dream subagent. */
    category: string
    /** Min hours since last consolidation. */
    minHoursSinceLast: number
    /** Min sessions touched since last consolidation. */
    minSessionsSinceLast: number
    /** Min messages since last dream. 0 = disabled, use time+session gates instead.
     *  When > 0, triggers dream after N messages accumulate across sessions.
     *  Example: 30 = trigger dream after 30 total messages since last dream run. */
    minMessagesSinceLast: number
    /** Lock stale timeout (ms) — defense against PID reuse. */
    lockStaleTimeoutMs: number
    /** Enable/disable auto-dream. */
    enabled: boolean
    /** Gate mode: development (every idle), normal (24h+5 sessions), production (7 days + memory pressure). */
    mode: "development" | "normal" | "production"
    /** Memory pressure threshold — trigger dream when memory count exceeds this. */
    memoryPressure: number
  }

  /** Staleness warnings — pure computation, no model. */
  staleness: {
    /** Days before a memory gets a staleness caveat. 0 = always warn. */
    warnAfterDays: number
  }

  /** MEMORY.md index caps. */
  entrypoint: {
    maxLines: number
    maxBytes: number
  }

  /** Scan limits. */
  scan: {
    /** Max files to scan (sorted newest-first). */
    maxFiles: number
    /** Max lines to read per file for frontmatter. */
    frontmatterMaxLines: number
  }

  /** Per-task model overrides. null = use agent/category default. */
  models: {
    recall: string | null
    extraction: string | null
    dream: string | null
  }

  /** Scope configuration — cross-project user memory + priority. */
  scope: {
    /** Enable cross-project user-level memory directory. */
    userScopeEnabled: boolean
    /** Recall priority: project memories override user memories on conflict. */
    projectOverridesUser: boolean
  }

  /** Logging configuration — route [memory:*] output to file, keep terminal clean. */
  logging: {
    /** Write logs to console (stdout/stderr). Default: false. */
    console: boolean
    /** Write logs to file. Default: true. */
    file: boolean
    /** Minimum level: debug | info | warn | error. */
    level: string
  }
}

// ---------------------------------------------------------------------------
// Defaults — tuned for free models (north-mini-code-free / deepseek-v4-flash)
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: MemoryPluginConfig = {
  enabled: true,
  storage: "filesystem",

  recall: {
    enabled: true,
    // Use explore agent (north-mini-code-free) for LLM rerank — 256 token
    // classification task, same complexity as code search.
    subagentType: "explore",
    background: true,
    maxCandidates: 20,
    maxResults: 5,
    maxTokens: 256,
    minQueryLength: 5,
    llmRerankDisabled: false,
  },

  extraction: {
    enabled: true,
    // Use quick category (deepseek-v4-flash-free) for structured note editing.
    category: "quick",
    minTokensToInit: 10000,
    minTokensBetweenUpdate: 5000,
    maxSectionLength: 2000,
    maxTotalTokens: 12000,
  },

  dream: {
    // Use deep category (deepseek-v4-flash-free) for multi-phase consolidation.
    category: "deep",
    minHoursSinceLast: 24,
    minSessionsSinceLast: 5,
    // 0 = disabled (use time+session gates). Set >0 to trigger by message count.
    minMessagesSinceLast: 0,
    lockStaleTimeoutMs: 3_600_000, // 1 hour
    enabled: true,
    mode: "normal",
    memoryPressure: 500,
  },

  staleness: {
    warnAfterDays: 1,
  },

  entrypoint: {
    maxLines: 200,
    maxBytes: 25_000,
  },

  scan: {
    maxFiles: 200,
    frontmatterMaxLines: 30,
  },

  models: {
    // null = use agent/category from oh-my-openagent defaults.
    // Set to e.g. "opencode/north-mini-code-free" to override.
    recall: null,
    extraction: null,
    dream: null,
  },

  scope: {
    userScopeEnabled: true,
    projectOverridesUser: true,
  },

  logging: {
    console: false,
    file: true,
    level: "debug",
  },
}

/** Merge user-provided options with defaults. */
export function resolveConfig(
  overrides?: Partial<MemoryPluginConfig>,
): MemoryPluginConfig {
  if (!overrides) {
    // Deep copy all nested objects to prevent DEFAULT_CONFIG pollution
    return {
      ...DEFAULT_CONFIG,
      recall: { ...DEFAULT_CONFIG.recall },
      extraction: { ...DEFAULT_CONFIG.extraction },
      dream: { ...DEFAULT_CONFIG.dream },
      staleness: { ...DEFAULT_CONFIG.staleness },
      entrypoint: { ...DEFAULT_CONFIG.entrypoint },
      scan: { ...DEFAULT_CONFIG.scan },
      models: { ...DEFAULT_CONFIG.models },
      scope: { ...DEFAULT_CONFIG.scope },
    }
  }
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    recall: { ...DEFAULT_CONFIG.recall, ...overrides.recall },
    extraction: { ...DEFAULT_CONFIG.extraction, ...overrides.extraction },
    dream: { ...DEFAULT_CONFIG.dream, ...overrides.dream },
    staleness: { ...DEFAULT_CONFIG.staleness, ...overrides.staleness },
    entrypoint: { ...DEFAULT_CONFIG.entrypoint, ...overrides.entrypoint },
    scan: { ...DEFAULT_CONFIG.scan, ...overrides.scan },
    models: { ...DEFAULT_CONFIG.models, ...overrides.models },
    scope: { ...DEFAULT_CONFIG.scope, ...overrides.scope },
  }
}

// ---------------------------------------------------------------------------
// Config file loading (memory.config.json)
// ---------------------------------------------------------------------------

/**
 * Raw shape of memory.config.json — user-facing, flat and readable.
 * Internal config (MemoryPluginConfig) is derived from this.
 */
interface ConfigFile {
  enabled?: boolean
  storage?: "filesystem"
  features?: {
    recall?: {
      enabled?: boolean
      agent?: string
      background?: boolean
      llm_rerank?: boolean
      max_candidates?: number
      max_results?: number
      max_tokens?: number
      min_query_length?: number
    }
    extraction?: {
      enabled?: boolean
      category?: string
      min_tokens_to_init?: number
      min_tokens_between_update?: number
      max_section_length?: number
      max_total_tokens?: number
    }
    dream?: {
      enabled?: boolean
      category?: string
      min_hours_since_last?: number
      min_sessions_since_last?: number
      min_messages_since_last?: number
      lock_stale_timeout_ms?: number
      mode?: string
      memory_pressure?: number
    }
    staleness?: {
      warn_after_days?: number
    }
    scope?: {
      user_scope_enabled?: boolean
      project_overrides_user?: boolean
    }
  }
  models?: {
    recall?: string | null
    extraction?: string | null
    dream?: string | null
  }
  entrypoint?: {
    max_lines?: number
    max_bytes?: number
  }
  scan?: {
    max_files?: number
    frontmatter_max_lines?: number
  }
  logging?: {
    console?: boolean
    file?: boolean
    level?: string
  }
}

/**
 * Load config from memory.config.json, falling back to defaults.
 * The file is expected alongside the plugin's package.json.
 */
export async function loadConfig(
  configPath?: string,
): Promise<MemoryPluginConfig> {
  const defaultPath = configPath ?? join(dirname(fileURLToPath(import.meta.url)), "..", "memory.config.json")

  try {
    const raw = await readFile(defaultPath, { encoding: "utf-8" })
    const file = JSON.parse(raw) as ConfigFile

    const recallDefaults = DEFAULT_CONFIG.recall
    const extractionDefaults = DEFAULT_CONFIG.extraction
    const dreamDefaults = DEFAULT_CONFIG.dream

    return {
      enabled: file.enabled ?? DEFAULT_CONFIG.enabled,
      storage: file.storage ?? DEFAULT_CONFIG.storage,

      recall: {
        enabled: file.features?.recall?.enabled ?? recallDefaults.enabled,
        subagentType: file.features?.recall?.agent ?? recallDefaults.subagentType,
        background: file.features?.recall?.background ?? recallDefaults.background,
        maxCandidates: file.features?.recall?.max_candidates ?? recallDefaults.maxCandidates,
        maxResults: file.features?.recall?.max_results ?? recallDefaults.maxResults,
        maxTokens: file.features?.recall?.max_tokens ?? recallDefaults.maxTokens,
        minQueryLength: file.features?.recall?.min_query_length ?? recallDefaults.minQueryLength,
        llmRerankDisabled: file.features?.recall?.llm_rerank === false,
      },

      extraction: {
        enabled: file.features?.extraction?.enabled ?? extractionDefaults.enabled,
        category: file.features?.extraction?.category ?? extractionDefaults.category,
        minTokensToInit: file.features?.extraction?.min_tokens_to_init ?? extractionDefaults.minTokensToInit,
        minTokensBetweenUpdate: file.features?.extraction?.min_tokens_between_update ?? extractionDefaults.minTokensBetweenUpdate,
        maxSectionLength: file.features?.extraction?.max_section_length ?? extractionDefaults.maxSectionLength,
        maxTotalTokens: file.features?.extraction?.max_total_tokens ?? extractionDefaults.maxTotalTokens,
      },

      dream: {
        category: file.features?.dream?.category ?? dreamDefaults.category,
        minHoursSinceLast: file.features?.dream?.min_hours_since_last ?? dreamDefaults.minHoursSinceLast,
        minSessionsSinceLast: file.features?.dream?.min_sessions_since_last ?? dreamDefaults.minSessionsSinceLast,
        minMessagesSinceLast: file.features?.dream?.min_messages_since_last ?? dreamDefaults.minMessagesSinceLast,
        lockStaleTimeoutMs: file.features?.dream?.lock_stale_timeout_ms ?? dreamDefaults.lockStaleTimeoutMs,
        enabled: file.features?.dream?.enabled ?? dreamDefaults.enabled,
        mode: (file.features?.dream?.mode ?? dreamDefaults.mode) as "development" | "normal" | "production",
        memoryPressure: file.features?.dream?.memory_pressure ?? dreamDefaults.memoryPressure,
      },

      staleness: {
        warnAfterDays: file.features?.staleness?.warn_after_days ?? DEFAULT_CONFIG.staleness.warnAfterDays,
      },

      entrypoint: {
        maxLines: file.entrypoint?.max_lines ?? DEFAULT_CONFIG.entrypoint.maxLines,
        maxBytes: file.entrypoint?.max_bytes ?? DEFAULT_CONFIG.entrypoint.maxBytes,
      },

      scan: {
        maxFiles: file.scan?.max_files ?? DEFAULT_CONFIG.scan.maxFiles,
        frontmatterMaxLines: file.scan?.frontmatter_max_lines ?? DEFAULT_CONFIG.scan.frontmatterMaxLines,
      },

      models: {
        recall: file.models?.recall ?? DEFAULT_CONFIG.models.recall,
        extraction: file.models?.extraction ?? DEFAULT_CONFIG.models.extraction,
        dream: file.models?.dream ?? DEFAULT_CONFIG.models.dream,
      },

      scope: {
        userScopeEnabled: file.features?.scope?.user_scope_enabled ?? DEFAULT_CONFIG.scope.userScopeEnabled,
        projectOverridesUser: file.features?.scope?.project_overrides_user ?? DEFAULT_CONFIG.scope.projectOverridesUser,
      },

      logging: {
        console: file.logging?.console ?? DEFAULT_CONFIG.logging.console,
        file: file.logging?.file ?? DEFAULT_CONFIG.logging.file,
        level: file.logging?.level ?? DEFAULT_CONFIG.logging.level,
      },
    }
  } catch {
    // Config file missing or invalid — use defaults (deep merge to avoid polluting DEFAULT_CONFIG)
    return resolveConfig()
  }
}
