/**
 * opencode-memory — Dream consolidation pipeline
 *
 * Four-phase memory consolidation: **Orient → Gather → Consolidate → Prune**.
 * Runs periodically when the scheduling gates pass (mode-specific).
 *
 * Gate modes (configured via `config.dream.mode`):
 *   - `development`: triggers every idle, 0 sessions required
 *   - `normal`: 24h + 5 sessions + memory pressure override
 *   - `production`: 7 days + memory pressure (count > 500 OR index > 25KB)
 *
 * Staging area: Dream writes proposed changes to `semantic/staging/`
 * instead of directly modifying long-term memories. The promotion layer
 * (`promotion.ts`) validates and promotes staged changes after all phases
 * complete. Proposed memories include provenance frontmatter
 * (`confidence.level: derived`, `source.kind: dream`, `schema_version: 2`).
 *
 * State: after each run, `state.json` is updated with `dream.last_run_at`,
 * `dream.total_runs`, and `dream.last_error` (on failure).
 *
 * Mutual exclusion is enforced via a `.consolidate-lock` file in the memory
 * directory. The lock is always released in a `finally` block, even on error.
 * All failures are caught and logged — Dream never throws.
 */

import { join } from "path"
import type { MemoryPluginConfig, AgentSessionCreateOptions } from "./config.js"
import { resolveAgentConfig } from "./config.js"
import type { MemoryStore } from "./store.js"
import type { RuntimeAdapter } from "./adapter.js"
import { info as logInfo, error as logError } from "./log.js"
import { loadState, updateState } from "./state.js"
import { parseFrontmatter } from "./store.js"
import { scanMemoryFiles, formatManifest } from "./scan.js"
import { acquireLock, releaseLock, getLockMtime, isLockHeld } from "./lock.js"
import { promoteStaging } from "./promotion.js"
import { checkMemoryPressure } from "./health.js"
import { logEvent } from "./telemetry.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000

// ---------------------------------------------------------------------------
// Lock path helper
// ---------------------------------------------------------------------------

function getLockPath(store: MemoryStore): string {
  return join(store.getDir(), ".consolidate-lock")
}

// ---------------------------------------------------------------------------
// Gate-mode scheduling (cheapest-first)
// ---------------------------------------------------------------------------

/**
 * Check whether dream consolidation should run.
 *
 * Gate modes (cheapest-first evaluation within each mode):
 *
 * | Mode         | Time gate    | Session gate | Memory pressure                     |
 * |--------------|-------------|-------------|-------------------------------------|
 * | development  | every idle  | 0           | none                                |
 * | normal       | 24h         | 5 sessions  | count > threshold                   |
 * | production   | 7 days      | —           | count > 500 OR index_size > 25KB   |
 *
 * Memory pressure can override the time gate — if the memory count exceeds
 * the threshold or the index is too large, Dream triggers regardless of
 * time/session gates.
 *
 * @param store  - Memory store for file listing.
 * @param config - Plugin configuration with dream settings.
 * @returns `true` if all applicable gates pass and consolidation should proceed.
 */
export async function shouldRunDream(
  store: MemoryStore,
  config: MemoryPluginConfig,
  statePath?: string,
): Promise<boolean> {
  const mode = config.dream.mode
  const lockPath = getLockPath(store)

  // Development mode: skip time and session gates — only check lock
  if (mode === "development") {
    const held = await isLockHeld(lockPath, config.dream.lockStaleTimeoutMs)
    return !held
  }

  // --- Gate 0: Message threshold (if configured, overrides time+session gates) ---
  if (config.dream.minMessagesSinceLast > 0 && statePath) {
    const state = await loadState(statePath)
    if (state.dream.messages_since_last >= config.dream.minMessagesSinceLast) {
      const held = await isLockHeld(lockPath, config.dream.lockStaleTimeoutMs)
      return !held
    }
    // Message threshold not met — don't fall through to time gate (user explicitly
    // configured message-based triggering). Return false.
    return false
  }

  // --- Gate 1: Time (cheapest — stat only) ---
  const lockMtime = await getLockMtime(lockPath)
  const hoursSinceLast = (Date.now() - lockMtime) / MS_PER_HOUR
  const requiredHours = mode === "production" ? 168 : config.dream.minHoursSinceLast
  // --- Gate 2: Memory pressure (multi-level) ---
  let pressureLevel: "normal" | "elevated" | "critical" = "normal"
  try {
    const pressure = await checkMemoryPressure(store, config)
    pressureLevel = pressure.level

    // Update state.json with pressure report (non-blocking)
    if (statePath) {
      void updateState(statePath, (s) => {
        s.memory_pressure = {
          level: pressure.level,
          files: pressure.fileCount,
          index_size: pressure.indexSize,
          total_size: pressure.totalSize,
          last_check: pressure.lastCheck,
        }
      }).catch(() => {})
    }
  } catch {
    // Pressure check failed — fall back to simple threshold
    const memoryCount = (await store.list()).length
    if (memoryCount > config.dream.memoryPressure) {
      pressureLevel = "critical"
    }
  }

  // Critical pressure: bypass time gate, trigger directly
  if (pressureLevel === "critical") {
    const held = await isLockHeld(lockPath, config.dream.lockStaleTimeoutMs)
    return !held
  }

  // Elevated pressure: reduce time gate requirement by half
  const effectiveRequiredHours = pressureLevel === "elevated"
    ? requiredHours / 2
    : requiredHours
  const timeGatePassed = hoursSinceLast >= effectiveRequiredHours

  // If time gate didn't pass and no critical pressure, don't run
  if (!timeGatePassed) {
    return false
  }

  // Session gate (normal mode only)
  const memories = await store.list()
  if (mode === "normal") {
    const recentCount = memories.filter((m) => m.mtimeMs > lockMtime).length
    if (recentCount < config.dream.minSessionsSinceLast) {
      return false
    }
  }

  // --- Gate 3: Lock (most expensive — read + stat + kill) ---
  const held = await isLockHeld(lockPath, config.dream.lockStaleTimeoutMs)
  if (held) {
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Agent response helpers
// ---------------------------------------------------------------------------

/** Extract plain text from an agent session response. */
function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>
    if (typeof obj.response === "string") return obj.response
    if (typeof obj.message === "string") return obj.message
    if (typeof obj.text === "string") return obj.text
    if (typeof obj.content === "string") return obj.content
    // Handle SDK message shape: { info: AssistantMessage, parts: [{ type: "text", text: "..." }] }
    if (Array.isArray(obj.parts)) {
      const textParts = (obj.parts as Array<Record<string, unknown>>)
        .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
      if (textParts.length > 0) return textParts.join("\n")
    }
  }
  return String(response)
}

/**
 * Extract and parse a JSON block from an agent response.
 *
 * Tries, in order:
 * 1. A fenced code block (` ```json ... ``` `)
 * 2. A bare `{...}` object at top level
 *
 * @throws If no valid JSON can be found in the response.
 */
function parseJsonResponse(response: unknown): unknown {
  const text = extractResponseText(response)

  // Try fenced JSON block first (most reliable for agent output)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    return JSON.parse(fenced[1].trim())
  }

  // Try bare {...} object (some agents omit the fence)
  const braced = text.match(/\{[\s\S]*\}/)
  if (braced) {
    return JSON.parse(braced[0])
  }

  throw new Error(
    `Could not parse JSON from agent response: ${text.slice(0, 200)}`,
  )
}

// ---------------------------------------------------------------------------
// Log date parsing
// ---------------------------------------------------------------------------

/** Extract a Date from a log file path like `logs/2026/07/2026-07-09.md`. */

// ---------------------------------------------------------------------------
// Agent client shape (kept for backward compatibility — use RuntimeAdapter)
// ---------------------------------------------------------------------------

/**
 * Minimal session-based agent client.
 *
 * @deprecated Use `RuntimeAdapter` from `./adapter.js` instead.
 * Kept for backward compatibility with tests that reference this type.
 */
export interface DreamAgentClient {
  session: {
    create: (opts: AgentSessionCreateOptions) => Promise<{ id: string }>
    chat: (id: string, opts: { message: string }) => Promise<unknown>
  }
}

// ---------------------------------------------------------------------------
// Provenance helper — add confidence/source to Dream's proposed memories
// ---------------------------------------------------------------------------

/**
 * Add provenance frontmatter to a proposed memory.
 *
 * Dream-derived memories always have:
 *   - `confidence.level: derived` (lowest priority — cannot override higher)
 *   - `source.kind: dream`
 *   - `source.fact_id: null` (no fact record linkage yet)
 *   - `schema_version: 2`
 *
 * Existing frontmatter fields (name, description, type, scope) are preserved.
 */
function ensureProvenance(content: string): string {
  const fm = parseFrontmatter(content)

  // Extract body (everything after frontmatter)
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  const body = fmMatch ? content.slice(fmMatch[0].length) : content

  const lines: string[] = ["---"]
  if (fm.name) lines.push(`name: ${fm.name}`)
  if (fm.description) lines.push(`description: ${fm.description}`)
  if (fm.type) lines.push(`type: ${fm.type}`)
  if (fm.scope) lines.push(`scope: ${fm.scope}`)
  lines.push("confidence:")
  lines.push("  level: derived")
  lines.push("source:")
  lines.push("  kind: dream")
  lines.push("  fact_id: null")
  lines.push("schema_version: 2")
  lines.push("---")
  lines.push("")
  lines.push(body)

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Phase 1+2 Combined — Prepare Dream Context
// ---------------------------------------------------------------------------

/**
 * Parse the combined orient+gather response.
 * Handles JSON wrapped in code fences or bare objects.
 *
 * Exported for unit testing.
 */
export function parsePrepareResponse(text: string): { orient: Record<string, unknown>; gather: Record<string, unknown> } {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fenceMatch ? fenceMatch[1] : text
  try {
    const parsed = JSON.parse(jsonText)
    return {
      orient: parsed.orient ?? {},
      gather: parsed.gather ?? {},
    }
  } catch {
    return { orient: {}, gather: {} }
  }
}

/**
 * Phase 1+2 Combined — Prepare Dream Context.
 *
 * Replaces separate orientPhase + gatherPhase with a single LLM call.
 * The 4-phase logical concept (orient → gather → consolidate → prune)
 * is preserved — this function returns both results as separate fields.
 */
async function prepareDreamContext(
  store: MemoryStore,
  config: MemoryPluginConfig,
  adapter: RuntimeAdapter,
): Promise<{ orient: unknown; gather: unknown }> {
  const memories = await scanMemoryFiles(store)
  const manifest = formatManifest(memories)

  const prompt = [
    "You are preparing dream consolidation context. Do two things:",
    "",
    "1. ORIENT: Identify memories that may be outdated, duplicated, or need merging.",
    "2. GATHER: For each candidate, describe the specific issue.",
    "",
    "## Current Memory Files",
    manifest || "(none)",
    "",
    "## Output Format (JSON only)",
    "```json",
    "{",
    '  "orient": {',
    '    "drift_candidates": ["file1.md", "file2.md"]',
    "  },",
    '  "gather": {',
    '    "facts": [',
    '      {"filename": "file1.md", "issue": "outdated - references deleted function"}',
    "    ]",
    "  }",
    "}",
    "```",
  ].join("\n")

  const createOpts = resolveAgentConfig(config, "dream")
  const session = await adapter.session.create(createOpts)
  const response = await adapter.session.prompt(session.id, prompt)
  const text = typeof response === "string" ? response : JSON.stringify(response)
  return parsePrepareResponse(text)
}

// ---------------------------------------------------------------------------
// Phase 1 — Orient (kept for fallback, but prepareDreamContext is preferred)
// ---------------------------------------------------------------------------

/**
 * Phase 1 — Orient.
 *
 * Scans the memory directory, reads the MEMORY.md index, and asks an agent
 * to analyze the current state. The agent identifies topics already covered,
 * gaps, stale files, and merge candidates.
 */
async function consolidatePhase(
  store: MemoryStore,
  config: MemoryPluginConfig,
  adapter: RuntimeAdapter,
  orientResult: unknown,
  gatherResult: unknown,
): Promise<{ writes: Array<{ filename: string; content: string }>; deletes: string[] }> {
  const memories = await scanMemoryFiles(store)
  const manifest = formatManifest(memories)

  const prompt = [
    `You are consolidating memory files. Write or update memory files based on the analysis below.`,
    ``,
    `## Orientation Analysis`,
    JSON.stringify(orientResult, null, 2),
    ``,
    `## Gathered Information`,
    JSON.stringify(gatherResult, null, 2),
    ``,
    `## Current Memory Files`,
    manifest || "(none)",
    ``,
    `## Guidelines`,
    `- MERGE into EXISTING files — never create a separate file for a topic`,
    `  that is already covered by an existing memory`,
    `- Use this frontmatter format for each file:`,
    `---`,
    `name: Descriptive Name`,
    `description: One-line summary of this memory's purpose`,
    `type: user | feedback | project | reference`,
    `---`,
    ``,
    `  Then the memory body in plain markdown.`,
    `- For the JSON output, escape newlines in the content field with \\n,`,
    `  or use a fenced code block with the JSON.`,
    ``,
    `Return your operations as JSON:`,
    `{`,
    `  "writes": [`,
    `    { "filename": "example.md", "content": "---\\nname: ...\\n---\\n\\nbody" }`,
    `  ],`,
    `  "deletes": ["old-file-that-should-be-removed.md"]`,
    `}`,
  ].join("\n")

  const createOpts = resolveAgentConfig(config, "dream")
  const session = await adapter.session.create(createOpts)
  const response = await adapter.session.prompt(session.id, prompt)

  const result = parseJsonResponse(response) as {
    writes?: Array<{ filename: string; content: string }>
    deletes?: string[]
  }

  const writes = result.writes ?? []
  const deletes = result.deletes ?? []

  // Write proposed changes to staging (not directly to memory directory)
  // Provenance frontmatter is added to each proposed memory
  for (const w of writes) {
    // Sanitize filename — prevent path traversal
    const safeFilename = w.filename.replace(/\.\./g, "").replace(/^[/\\]+/, "")
    const contentWithProvenance = ensureProvenance(w.content)
    // Write to semantic/staging/ — store.write creates parent dirs
    await store.write(`semantic/staging/${safeFilename}`, contentWithProvenance)
  }

  // Deletes are logged but not executed directly — they go through staging
  // (future: delete proposals via staging; for now, just log for visibility)
  for (const f of deletes) {
    logInfo("memory:dream", `delete proposed (not executed directly): ${f}`)
  }

  return { writes, deletes }
}

// ---------------------------------------------------------------------------
// Phase 4 — Prune
// ---------------------------------------------------------------------------

/**
 * Phase 4 — Prune.
 *
 * Re-scans all memory files (after consolidation writes/deletes), builds a
 * fresh MEMORY.md index sorted by type then filename, and enforces the
 * entrypoint caps (`maxLines` and `maxBytes`).
 *
 * Files in internal directories (`semantic/`, `processing/`, `fact/`,
 * `legacy/`) are excluded from the index — they are pipeline-internal.
 *
 * Sorting order: user → feedback → project → reference → untagged.
 * Within the same type, files are sorted alphabetically by filename.
 *
 * Note: after this phase, `promoteStaging()` runs and may update the index
 * again to reflect promoted changes.
 */
async function prunePhase(
  store: MemoryStore,
  config: MemoryPluginConfig,
): Promise<void> {
  // Re-scan files after consolidation writes/deletes
  const memories = await scanMemoryFiles(store)

  // Filter out internal directories
  const externalMemories = memories.filter(
    (m) =>
      !m.filename.startsWith("semantic/") &&
      !m.filename.startsWith("processing/") &&
      !m.filename.startsWith("fact/") &&
      !m.filename.startsWith("legacy/"),
  )

  // Prune stale memories: not recalled in 180 days AND not explicit confidence
  // Never delete explicit memories — user-stated facts are always preserved
  const PRUNE_AFTER_DAYS = 180
  const now = Date.now()
  const staleMemories = externalMemories.filter((m) => {
    if (m.confidence === "explicit") return false // never delete explicit
    if (!m.lastRecalledAt) return false // never recalled = might be new, skip
    const recalledTime = new Date(m.lastRecalledAt).getTime()
    if (Number.isNaN(recalledTime)) return false
    const daysSinceRecall = Math.floor((now - recalledTime) / 86_400_000)
    return daysSinceRecall > PRUNE_AFTER_DAYS
  })
  for (const m of staleMemories) {
    try {
      await store.delete(m.filename)
    } catch {
      // skip deletion failures
    }
  }

  // Re-scan after pruning to get the final set
  const finalMemories = (await scanMemoryFiles(store)).filter(
    (m) =>
      !m.filename.startsWith("semantic/") &&
      !m.filename.startsWith("processing/") &&
      !m.filename.startsWith("fact/") &&
      !m.filename.startsWith("legacy/"),
  )

  // Sort by type (canonical order) then filename
  const typeOrder: Record<string, number> = {
    user: 0,
    feedback: 1,
    project: 2,
    reference: 3,
  }

  const sorted = [...finalMemories].sort((a, b) => {
    const ta = a.type !== undefined ? (typeOrder[a.type] ?? 99) : 99
    const tb = b.type !== undefined ? (typeOrder[b.type] ?? 99) : 99
    if (ta !== tb) return ta - tb
    return a.filename.localeCompare(b.filename)
  })

  // Build index lines in the correct MEMORY.md format:
  //   - [Name](filename.md) — description
  // (NOT formatManifest which produces - [scope:type] filename (timestamp): description)
  const indexLines: string[] = []
  for (const m of sorted) {
    try {
      const content = await store.read(m.filename)
      const fm = parseFrontmatter(content)
      const name = fm.name ?? m.description ?? m.filename
      const desc = m.description ?? ""
      indexLines.push(`- [${name}](${m.filename}) — ${desc}`)
    } catch {
      // Skip unreadable files
    }
  }

  let newIndex = indexLines.join("\n")

  // Enforce maxLines cap
  let lines = newIndex.split("\n")
  if (lines.length > config.entrypoint.maxLines) {
    newIndex = lines.slice(0, config.entrypoint.maxLines).join("\n") + "\n"
    // Re-split after line truncation so byte cap uses truncated content
    lines = newIndex.split("\n")
  }

  // Enforce maxBytes cap
  const encoder = new TextEncoder()
  if (encoder.encode(newIndex).length > config.entrypoint.maxBytes) {
    // Trim line-by-line until under the byte limit
    const keep: string[] = []
    let bytes = 0
    for (const line of lines) {
      const lineBytes = encoder.encode(line + "\n").length
      if (bytes + lineBytes > config.entrypoint.maxBytes) break
      keep.push(line)
      bytes += lineBytes
    }
    newIndex = keep.join("\n")
    if (!newIndex.endsWith("\n")) newIndex += "\n"
  }

  await store.updateIndex(newIndex)
}

// ---------------------------------------------------------------------------
// Main entry: runDreamConsolidation
// ---------------------------------------------------------------------------

/**
 * Run the full dream consolidation pipeline.
 *
 * Execution flow:
 * ```
 * acquireLock → Orient → Gather → Consolidate → Prune → promoteStaging → releaseLock
 * ```
 *
 * The lock is acquired at the start and **always** released in a `finally`
 * block, even when a phase throws.
 *
 * After all phases complete, `promoteStaging()` validates and promotes
 * staged changes to long-term memory. State is updated in `state.json`
 * regardless of success or failure.
 *
 * @param store   - Memory store for all file operations.
 * @param config  - Plugin configuration (uses `config.dream` settings).
 * @param adapter - Runtime adapter for LLM-session creation and prompting.
 * @returns Result object with `success` flag, completed `phases` array on
 *          success, or an `error` string on failure.
 */
export async function runDreamConsolidation(
  store: MemoryStore,
  config: MemoryPluginConfig,
  adapter: RuntimeAdapter,
): Promise<{ success: boolean; phases?: string[]; error?: string }> {
  const lockPath = getLockPath(store)

  // Step 1: Acquire mutual-exclusion lock
  const acquired = await acquireLock(lockPath, config.dream.lockStaleTimeoutMs)
  if (!acquired) {
    return { success: false, error: "locked" }
  }

  const phases: string[] = []
  const errors: string[] = []
  const t0 = Date.now()

  void logEvent(store.getDir(), {
    timestamp: new Date().toISOString(),
    type: "dream.started",
  })

  try {
    // Phase 1+2 — Prepare (combined orient + gather, single LLM call)
    let orientResult: unknown = {}
    let gatherResult: unknown = {}
    try {
      const prepared = await prepareDreamContext(store, config, adapter)
      orientResult = prepared.orient
      gatherResult = prepared.gather
      phases.push("orient", "gather")
    } catch (err) {
      errors.push(`prepare: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Phase 3 — Consolidate (depends on prepare results)
    if (phases.includes("orient")) {
      try {
        await consolidatePhase(store, config, adapter, orientResult, gatherResult)
        phases.push("consolidate")
      } catch (err) {
        errors.push(`consolidate: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Phase 4 — Prune (reads actual files on disk, no agent needed)
    try {
      await prunePhase(store, config)
      phases.push("prune")
    } catch (err) {
      errors.push(`prune: ${err instanceof Error ? err.message : String(err)}`)
    }

    // After all phases: promote staged changes to long-term memory
    try {
      const promoResult = await promoteStaging(store, store.getDir(), config)
      logInfo("memory:dream", `promotion: ${promoResult.promoted} promoted, ${promoResult.rejected} rejected, ${promoResult.conflicts} conflicts`)
    } catch (err) {
      errors.push(`promotion: ${err instanceof Error ? err.message : String(err)}`)
    }

    void logEvent(store.getDir(), {
      timestamp: new Date().toISOString(),
      type: "dream.completed",
      duration_ms: Date.now() - t0,
      payload: { phases },
    })

    return {
      success: errors.length === 0,
      phases,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(message)
    return { success: false, error: errors.join("; ") }
  } finally {
    // Update state.json — always, regardless of success/failure
    const statePath = join(store.getDir(), "state.json")
    try {
      await updateState(statePath, (s) => {
        s.dream.last_run_at = new Date().toISOString()
        s.dream.total_runs++
        s.dream.mode = config.dream.mode
        // Reset message counter — dream consumed the accumulated messages
        s.dream.messages_since_last = 0
        if (errors.length > 0) {
          s.dream.last_error = errors.join("; ")
        } else {
          s.dream.last_error = null
        }
      })
    } catch (err) {
      // State update failure should not mask the original result
      logError("memory:dream", `failed to update state: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Log outcome
    if (errors.length > 0) {
      logError("memory:dream", `completed with errors: ${errors.join("; ")}`)
    } else {
      logInfo("memory:dream", `completed successfully: ${phases.join(" -> ")}`)
    }

    // Release lock — best-effort, never throw from finally
    try {
      await releaseLock(lockPath)
    } catch (err) {
      logError("memory:dream", `failed to release lock: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
