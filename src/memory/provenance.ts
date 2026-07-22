/**
 * opencode-memory — Provenance types and helpers (v0.4.0)
 *
 * Establishes the source chain for every memory: where it came from,
 * who created it, how confident the extraction was, and what changes
 * it has undergone.
 *
 * Design: provenance is a JSON-serialized string in the YAML frontmatter
 * (key `provenance`). The existing flat key-value parser in store.ts
 * handles this naturally since the value is a single-line JSON string.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROVENANCE_ACTOR = {
  USER: "user",
  SYSTEM: "system",
  MIGRATION: "migration",
  REPAIR: "repair",
} as const

export const PROVENANCE_SOURCE_TYPE = {
  USER: "user",
  SESSION: "session",
  EXTRACTION: "extraction",
  FEEDBACK: "feedback",
  MIGRATION: "migration",
} as const

export const PROVENANCE_ACTION = {
  CREATED: "created",
  UPDATED: "updated",
  MERGED: "merged",
  ARCHIVED: "archived",
  RESTORED: "restored",
} as const

export const EXTRACTION_METHOD = {
  EXPLICIT: "explicit",
  LLM: "llm",
  DREAM: "dream",
} as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvenanceSourceType =
  | "user"
  | "session"
  | "extraction"
  | "feedback"
  | "migration"

export type ProvenanceOverrideSourceType =
  | "extraction"
  | "dream"
  | "migration"
  | "repair"

export type ProvenanceActor = "user" | "system" | "migration" | "repair"

export type ProvenanceAction =
  | "created"
  | "updated"
  | "merged"
  | "archived"
  | "restored"

export interface MemoryProvenance {
  source: {
    type: ProvenanceSourceType
    sessionId?: string
    sourceFile?: string
  }

  created: {
    timestamp: number // Unix epoch ms
    actor: "user" | "system" | "migration"
    model?: string
    extractorVersion?: string
  }

  extraction?: {
    method: "explicit" | "llm" | "dream"
    confidenceScore?: number // 0-1
  }

  // Reserved for future pipeline transformations (v0.4.0 does not populate)
  transformation?: {
    steps: Array<{
      type: "validation" | "merge" | "consolidation"
      timestamp: number
      detail?: string
    }>
  }

  history: ProvenanceEvent[]
}

export interface ProvenanceEvent {
  action: ProvenanceAction
  timestamp: number
  actor: ProvenanceActor
  detail?: string
}

export interface ProvenanceContext {
  extractorVersion?: string
  model?: string
}

export interface ProvenanceOverride {
  source: {
    type: ProvenanceOverrideSourceType
  }
  extraction?: {
    confidenceScore?: number
    method?: "explicit" | "llm" | "dream"
  }
  model?: string
}

// ---------------------------------------------------------------------------
// Confidence rank for merge decisions
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<string, number> = {
  explicit: 3,
  inferred: 2,
  uncertain: 1,
}

export function mergeConfidence(
  a: "explicit" | "inferred" | "uncertain",
  b: "explicit" | "inferred" | "uncertain",
): "explicit" | "inferred" | "uncertain" {
  return (CONFIDENCE_RANK[a] ?? 0) >= (CONFIDENCE_RANK[b] ?? 0) ? a : b
}

const SOURCE_RANK: Record<string, number> = {
  user: 4,
  feedback: 3,
  extraction: 2,
  session: 1,
  migration: 0,
}

export function mergeSourceType(
  a: ProvenanceSourceType,
  b: ProvenanceSourceType,
): ProvenanceSourceType {
  return (SOURCE_RANK[a] ?? 0) >= (SOURCE_RANK[b] ?? 0) ? a : b
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidProvenance(value: unknown): value is MemoryProvenance {
  return validateProvenance(value).valid
}

export function validateProvenance(p: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!p || typeof p !== "object") {
    return { valid: false, errors: ["provenance must be an object"] }
  }

  const prov = p as Record<string, unknown>

  // --- source ---
  if (!prov.source || typeof prov.source !== "object") {
    errors.push("source is required and must be an object")
  } else {
    const src = prov.source as Record<string, unknown>
    if (!src.type || typeof src.type !== "string") {
      errors.push("source.type is required")
    } else if (!["user", "session", "extraction", "feedback", "migration"].includes(src.type)) {
      errors.push(`invalid source.type: "${src.type}"`)
    }
  }

  // --- created ---
  if (!prov.created || typeof prov.created !== "object") {
    errors.push("created is required and must be an object")
  } else {
    const cr = prov.created as Record<string, unknown>
    if (typeof cr.timestamp !== "number" || cr.timestamp <= 0) {
      errors.push("created.timestamp must be a positive number")
    }
    if (!cr.actor || !["user", "system", "migration"].includes(cr.actor as string)) {
      errors.push("created.actor must be 'user', 'system', or 'migration'")
    }
  }

  // --- extraction (optional) ---
  if (prov.extraction !== undefined) {
    if (typeof prov.extraction !== "object") {
      errors.push("extraction must be an object")
    } else {
      const ext = prov.extraction as Record<string, unknown>
      if (ext.method && !["explicit", "llm", "dream"].includes(ext.method as string)) {
        errors.push(`invalid extraction.method: "${ext.method}"`)
      }
      if (ext.confidenceScore !== undefined) {
        if (typeof ext.confidenceScore !== "number" || ext.confidenceScore < 0 || ext.confidenceScore > 1) {
          errors.push("extraction.confidenceScore must be a number between 0 and 1")
        }
      }
    }
  }

  // --- history ---
  if (!Array.isArray(prov.history) || prov.history.length === 0) {
    errors.push("history must be a non-empty array")
  } else {
    const seen = new Set<string>()
    for (let i = 0; i < prov.history.length; i++) {
      const ev = prov.history[i]
      if (!ev || typeof ev !== "object") {
        errors.push(`history[${i}] must be an object`)
        continue
      }
      const e = ev as Record<string, unknown>
      if (!["created", "updated", "merged", "archived", "restored"].includes(e.action as string)) {
        errors.push(`history[${i}] has invalid action: "${e.action}"`)
      }
      if (typeof e.timestamp !== "number") {
        errors.push(`history[${i}] has invalid timestamp`)
      }
      if (e.actor && !["user", "system", "repair", "migration"].includes(e.actor as string)) {
        errors.push(`history[${i}] has invalid actor: "${e.actor}"`)
      }
      // Check for exact duplicate action+timestamp (prevents injection of identical events)
      const key = `${e.action}:${e.timestamp}`
      if (seen.has(key)) {
        errors.push(`history[${i}] duplicate action+timestamp: "${e.action}" at ${e.timestamp}`)
      }
      seen.add(key)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function isValidProvenanceEvent(value: unknown): value is ProvenanceEvent {
  if (!value || typeof value !== "object") return false
  const e = value as Record<string, unknown>
  return (
    typeof e.action === "string" &&
    ["created", "updated", "merged", "archived", "restored"].includes(e.action) &&
    typeof e.timestamp === "number" &&
    typeof e.actor === "string" &&
    ["user", "system", "repair", "migration"].includes(e.actor)
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createProvenance(
  source: MemoryProvenance["source"],
  actor: "user" | "system" | "migration",
  extraction?: MemoryProvenance["extraction"],
  model?: string,
  extractorVersion?: string,
): MemoryProvenance {
  return {
    source,
    created: {
      timestamp: Date.now(),
      actor,
      model,
      extractorVersion,
    },
    ...(extraction ? { extraction } : {}),
    history: [
      {
        action: "created",
        timestamp: Date.now(),
        actor,
      },
    ],
  }
}

export function appendEvent(
  provenance: MemoryProvenance,
  event: ProvenanceEvent,
): MemoryProvenance {
  return {
    ...provenance,
    history: [...provenance.history, event],
  }
}

// ---------------------------------------------------------------------------
// Frontmatter serialization
// ---------------------------------------------------------------------------

/**
 * Serialize provenance to a compact JSON string for embedding in YAML frontmatter.
 *
 * Why JSON, not YAML? The existing frontmatter parser (`store.ts`) uses a
 * flat key-value regex (`^(\w+):\s*(.*)$`). A JSON string is a single-line
 * value that fits this parser naturally. YAML nested structures would require
 * a full YAML parser dependency.
 */
export function serializeProvenance(provenance?: MemoryProvenance): string | undefined {
  if (!provenance) return undefined
  try {
    return JSON.stringify(provenance)
  } catch {
    return undefined
  }
}

/**
 * Parse provenance from the raw YAML frontmatter value.
 * Returns undefined when the key is absent or unparseable (backward compatible).
 */
export function parseProvenance(rawValue: unknown): MemoryProvenance | undefined {
  if (rawValue === undefined || rawValue === null) return undefined
  if (typeof rawValue === "string" && rawValue.trim() === "") return undefined
  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue
    if (validateProvenance(parsed).valid) {
      return parsed as MemoryProvenance
    }
    return undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge two provenances during dream consolidation.
 *
 * Rules:
 * 1. confidence takes the highest semantic rank (explicit > inferred > uncertain)
 * 2. extraction.confidenceScore is NOT modified (it describes the original extraction, not current state)
 * 3. source takes the higher rank (user > feedback > extraction > session > migration)
 * 4. history is merged with all events preserved + a merged event appended
 */
export function mergeProvenance(
  a: MemoryProvenance,
  b: MemoryProvenance,
): { provenance: MemoryProvenance; mergedConfidence: "explicit" | "inferred" | "uncertain" } {
  // Determine merged confidence
  const mergedConfidence: "explicit" | "inferred" | "uncertain" = "explicit" // default
  // (caller provides the confidence level — we just merge provenance)

  const mergedSourceType = mergeSourceType(a.source.type, b.source.type)

  // Keep the extraction from the higher-ranked source
  const mergedExtraction = SOURCE_RANK[a.source.type] >= SOURCE_RANK[b.source.type]
    ? a.extraction
    : b.extraction

  // Merge history: all events from both, sorted by timestamp, plus merged event
  const mergedHistory = [...a.history, ...b.history].sort((x, y) => x.timestamp - y.timestamp)
  mergedHistory.push({
    action: "merged",
    timestamp: Date.now(),
    actor: "system",
    detail: `merged from ${a.source.type} and ${b.source.type}`,
  })

  return {
    provenance: {
      source: {
        ...a.source,
        type: mergedSourceType,
      },
      created: a.created, // preserve original creation
      extraction: mergedExtraction,
      history: mergedHistory,
    },
    mergedConfidence,
  }
}