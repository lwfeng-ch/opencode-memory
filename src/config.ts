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

/**
 * Resolve agent config for a specific pipeline stage.
 * Priority: agents.{stage} > legacy config (models.{stage} / *.category / *.subagentType)
 *
 * Safety: category labels (quick/deep/explore) are NOT passed as body.agent
 * (historical bug: SDK returns HTTP 500 for unrecognized agent names).
 */
export function resolveAgentConfig(
  config: MemoryPluginConfig,
  stage: "recall" | "extraction" | "dream",
): AgentSessionCreateOptions {
  const agentConfig = config.agents[stage]
  const model = agentConfig.model ?? config.models[stage] ?? undefined
  let agent: string | undefined
  if (stage === "recall") {
    agent = agentConfig.agent ?? config.recall.subagentType
  } else {
    agent = agentConfig.agent ?? agentConfig.category
  }
  const opts: AgentSessionCreateOptions = {}
  // Category labels must not be passed as body.agent
  if (agent && !["quick", "deep", "explore"].includes(agent)) {
    opts.agent = agent
  }
  if (model) opts.model = model
  return opts
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
  /** Recall usage tracking (P1) */
  recallCount: number
  lastRecalledAt: string | null
  /** v0.3.4: Lifecycle status — defaults to "active" for backward compat */
  status?: "active" | "archived"
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

  /**
   * Governance configuration — autonomous governance cycle (v0.5.3).
   * All default to false/0 — opt-in only.
   */
  governance: {
    /** Enable/disable autonomous governance. Default false (opt-in). */
    enabled: boolean
    /** Auto-execute low-risk candidates. Default false (review-only). */
    autoExecute: boolean
    /** Max candidates to auto-execute per run. Default 5. */
    maxAutoPerRun: number
    /** Min hours between governance runs. Default 24. */
    minHoursBetweenRuns: number
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

  /** Memory pressure thresholds for 3-level health detection */
  memoryPressure: {
    maxFiles: number
    maxIndexSize: number
    maxTotalSize: number
    elevatedRatio: number
    criticalRatio: number
  }

  /** Telemetry structured event logging */
  telemetry: {
    enabled: boolean
    retentionDays: number
    maxFileBytes: number
  }

  /** Per-stage agent/model configuration */
  agents: {
    extraction: { agent?: string; model?: string; category?: string }
    dream: { agent?: string; model?: string; category?: string }
    recall: { agent?: string; model?: string; category?: string }
  }

  /**
   * Experimental features (v0.3.4+).
   *
   * These are opt-in features that change core contracts.
   * Each flag defaults to false — users must explicitly enable.
   * Once a feature stabilizes (no regressions for one version), it becomes
   * default true and the flag is removed in the next version.
   */
  experimental?: {
    /**
     * Enable dual-manifest archive index (v0.3.4 Phase 0).
     *
     * - false (default): single MEMORY.md, all files indexed together (v0.3.3 behavior)
     * - true: dual manifest — MEMORY.md (active only) + ARCHIVE.md (archived only, lazy-created)
     *
     * When enabled, RepairService.archive() / restore() also update both manifests
     * atomically (manifest-pair-first, frontmatter-last). memory_list defaults to
     * active-only; use `--all` or `--archived` to access archive entries.
     *
     * Do NOT toggle mid-session — ARCHIVE.md may become inconsistent.
     */
    archiveIndex?: boolean
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

  memoryPressure: {
    maxFiles: 500,
    maxIndexSize: 25_000,
    maxTotalSize: 5_242_880,
    elevatedRatio: 0.7,
    criticalRatio: 0.9,
  },

  telemetry: {
    enabled: true,
    retentionDays: 30,
    maxFileBytes: 10_485_760,
  },

  agents: {
    extraction: { category: "quick" },
    dream: { category: "deep" },
    recall: { agent: "explore" },
  },

  // v0.5.3: Autonomous governance — opt-in only, all default false
  governance: {
    enabled: false,
    autoExecute: false,
    maxAutoPerRun: 5,
    minHoursBetweenRuns: 24,
  },

  // v0.3.4+: experimental features, all default false
  experimental: {
    archiveIndex: false,
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
      memoryPressure: { ...DEFAULT_CONFIG.memoryPressure },
      telemetry: { ...DEFAULT_CONFIG.telemetry },
      agents: {
        extraction: { ...DEFAULT_CONFIG.agents.extraction },
        dream: { ...DEFAULT_CONFIG.agents.dream },
        recall: { ...DEFAULT_CONFIG.agents.recall },
      },
      experimental: { ...DEFAULT_CONFIG.experimental },
      governance: { ...DEFAULT_CONFIG.governance },
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
    memoryPressure: { ...DEFAULT_CONFIG.memoryPressure, ...overrides.memoryPressure },
    telemetry: { ...DEFAULT_CONFIG.telemetry, ...overrides.telemetry },
    agents: {
      extraction: { ...DEFAULT_CONFIG.agents.extraction, ...overrides.agents?.extraction },
      dream: { ...DEFAULT_CONFIG.agents.dream, ...overrides.agents?.dream },
      recall: { ...DEFAULT_CONFIG.agents.recall, ...overrides.agents?.recall },
    },
    experimental: { ...DEFAULT_CONFIG.experimental, ...overrides.experimental },
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
    governance?: {
      enabled?: boolean
      auto_execute?: boolean
      max_auto_per_run?: number
      min_hours_between_runs?: number
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
  memoryPressure?: {
    max_files?: number
    max_index_size?: number
    max_total_size?: number
    elevated_ratio?: number
    critical_ratio?: number
  }
  telemetry?: {
    enabled?: boolean
    retention_days?: number
    max_file_bytes?: number
  }
  agents?: {
    extraction?: { agent?: string; model?: string; category?: string }
    dream?: { agent?: string; model?: string; category?: string }
    recall?: { agent?: string; model?: string; category?: string }
  }
  /** v0.5.3: Autonomous governance — opt-in only */
  governance?: {
    enabled?: boolean
    auto_execute?: boolean
    max_auto_per_run?: number
    min_hours_between_runs?: number
  }
  /** v0.3.4+ experimental features — opt-in only, default false */
  experimental?: {
    archive_index?: boolean
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

      memoryPressure: {
        maxFiles: file.memoryPressure?.max_files ?? DEFAULT_CONFIG.memoryPressure.maxFiles,
        maxIndexSize: file.memoryPressure?.max_index_size ?? DEFAULT_CONFIG.memoryPressure.maxIndexSize,
        maxTotalSize: file.memoryPressure?.max_total_size ?? DEFAULT_CONFIG.memoryPressure.maxTotalSize,
        elevatedRatio: file.memoryPressure?.elevated_ratio ?? DEFAULT_CONFIG.memoryPressure.elevatedRatio,
        criticalRatio: file.memoryPressure?.critical_ratio ?? DEFAULT_CONFIG.memoryPressure.criticalRatio,
      },

      telemetry: {
        enabled: file.telemetry?.enabled ?? DEFAULT_CONFIG.telemetry.enabled,
        retentionDays: file.telemetry?.retention_days ?? DEFAULT_CONFIG.telemetry.retentionDays,
        maxFileBytes: file.telemetry?.max_file_bytes ?? DEFAULT_CONFIG.telemetry.maxFileBytes,
      },

      agents: {
        extraction: {
          agent: file.agents?.extraction?.agent,
          model: file.agents?.extraction?.model,
          category: file.agents?.extraction?.category ?? DEFAULT_CONFIG.agents.extraction.category,
        },
        dream: {
          agent: file.agents?.dream?.agent,
          model: file.agents?.dream?.model,
          category: file.agents?.dream?.category ?? DEFAULT_CONFIG.agents.dream.category,
        },
        recall: {
          agent: file.agents?.recall?.agent ?? file.features?.recall?.agent ?? DEFAULT_CONFIG.agents.recall.agent,
          model: file.agents?.recall?.model,
          category: file.agents?.recall?.category,
        },
      },

      experimental: {
        archiveIndex: file.experimental?.archive_index ?? DEFAULT_CONFIG.experimental!.archiveIndex,
      },

      governance: {
        enabled: file.features?.governance?.enabled ?? DEFAULT_CONFIG.governance.enabled,
        autoExecute: file.features?.governance?.auto_execute ?? DEFAULT_CONFIG.governance.autoExecute,
        maxAutoPerRun: file.features?.governance?.max_auto_per_run ?? DEFAULT_CONFIG.governance.maxAutoPerRun,
        minHoursBetweenRuns: file.features?.governance?.min_hours_between_runs ?? DEFAULT_CONFIG.governance.minHoursBetweenRuns,
      },
    }
  } catch {
    // Config file missing or invalid — use defaults (deep merge to avoid polluting DEFAULT_CONFIG)
    return resolveConfig()
  }
}
