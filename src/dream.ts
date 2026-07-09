/**
 * opencode-memory — Dream consolidation pipeline
 *
 * Four-phase memory consolidation: **Orient → Gather → Consolidate → Prune**.
 * Runs periodically when the three scheduling gates pass (cheapest-first to
 * short-circuit early and avoid expensive checks when consolidation is not
 * needed).
 *
 * Scheduling gates (in `shouldRunDream()`):
 *   1. **Time gate** (cheapest) — minimum hours since last consolidation
 *   2. **Sessions gate** (medium) — minimum files modified since last
 *      consolidation (file mtime as a proxy for session activity)
 *   3. **Lock gate** (most expensive) — check if another process is already
 *      consolidating
 *
 * The consolidation pipeline (`runDreamConsolidation()`):
 *   1. **Orient** — scan existing memories, read the MEMORY.md index, build
 *      a picture of current state and identify gaps.
 *   2. **Gather** — mine daily logs for recent activity and check for
 *      drifted (outdated) memories.
 *   3. **Consolidate** — write, update, and merge memory files based on
 *      insights from orient and gather.
 *   4. **Prune** — re-scan files, regenerate the index, enforce entrypoint
 *      caps (maxLines / maxBytes), and sort entries.
 *
 * Mutual exclusion is enforced via a `.consolidate-lock` file in the memory
 * directory. The lock is always released in a `finally` block, even on error.
 */

import { join } from "path"
import type { MemoryPluginConfig } from "./config.js"
import type { MemoryStore } from "./store.js"
import { parseFrontmatter } from "./store.js"
import { scanMemoryFiles, formatManifest } from "./scan.js"
import { acquireLock, releaseLock, getLockMtime, isLockHeld } from "./lock.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Lock path helper
// ---------------------------------------------------------------------------

function getLockPath(store: MemoryStore): string {
  return join(store.getDir(), ".consolidate-lock")
}

// ---------------------------------------------------------------------------
// Three-gate scheduling (cheapest-first)
// ---------------------------------------------------------------------------

/**
 * Check whether dream consolidation should run.
 *
 * Three gates, evaluated cheapest-first so we short-circuit as early as
 * possible:
 *
 * | Gate   | Cost      | What it checks                          |
 * |--------|-----------|-----------------------------------------|
 * | 1 Time | Cheapest  | Hours since last lock mtime             |
 * | 2 Files| Medium    | Files modified since last lock mtime    |
 * | 3 Lock | Expensive | Whether another process holds the lock  |
 *
 * @param store  - Memory store for file listing.
 * @param config - Plugin configuration with dream settings.
 * @returns `true` if all three gates pass and consolidation should proceed.
 */
export async function shouldRunDream(
  store: MemoryStore,
  config: MemoryPluginConfig,
): Promise<boolean> {
  const lockPath = getLockPath(store)

  // --- Gate 1: Time (cheapest — stat only) ---
  const lockMtime = await getLockMtime(lockPath)
  const hoursSinceLast = (Date.now() - lockMtime) / MS_PER_HOUR
  if (hoursSinceLast < config.dream.minHoursSinceLast) {
    return false
  }

  // --- Gate 2: Sessions (medium — list + filter) ---
  const memories = await store.list()
  const recentCount = memories.filter((m) => m.mtimeMs > lockMtime).length
  if (recentCount < config.dream.minSessionsSinceLast) {
    return false
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
function parseLogDate(filename: string): Date | null {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})\.md$/)
  if (!match) return null
  const d = new Date(match[1] + "T00:00:00Z")
  return isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// Agent client shape
// ---------------------------------------------------------------------------

/**
 * Minimal session-based agent client.
 *
 * `session.create` starts a new agent session (with an optional agent/category
 * hint), and `session.chat` sends a message to an existing session.
 */
export interface DreamAgentClient {
  session: {
    create: (opts: Record<string, unknown>) => Promise<{ id: string }>
    chat: (id: string, opts: { message: string }) => Promise<unknown>
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — Orient
// ---------------------------------------------------------------------------

/**
 * Phase 1 — Orient.
 *
 * Scans the memory directory, reads the MEMORY.md index, and asks an agent
 * to analyze the current state. The agent identifies topics already covered,
 * gaps, stale files, and merge candidates.
 */
async function orientPhase(
  store: MemoryStore,
  config: MemoryPluginConfig,
  client: DreamAgentClient,
): Promise<unknown> {
  const memories = await scanMemoryFiles(store)
  const index = await store.getIndex()
  const manifest = formatManifest(memories)

  const prompt = [
    `You are analyzing a memory directory for the opencode-memory consolidation pipeline.`,
    ``,
    `## Current State`,
    `- Memory directory: ${store.getDir()}`,
    `- Total memory files: ${memories.length}`,
    ``,
    `## MEMORY.md Index`,
    index ?? "(no index yet — empty or uninitialized)",
    ``,
    `## File Manifest (headers)`,
    manifest || "(no memory files)",
    ``,
    `## Task`,
    `Analyze this state and identify:`,
    `(a) Topics already covered in existing memories — list each unique topic`,
    `(b) Gaps — topics that should be covered but are missing`,
    `(c) Files that look stale, redundant, or could be merged with others`,
    ``,
    `Return your analysis as JSON:`,
    `{`,
    `  "topics": ["topic1", "topic2"],`,
    `  "gaps": ["missing topic 1"],`,
    `  "staleFiles": ["filename.md"],`,
    `  "mergeCandidates": [["file1.md", "file2.md"]],`,
    `  "notes": "any additional observations"`,
    `}`,
  ].join("\n")

  const session = await client.session.create({
    agent: config.dream.category,
  })
  const response = await client.session.chat(session.id, { message: prompt })
  return parseJsonResponse(response)
}

// ---------------------------------------------------------------------------
// Phase 2 — Gather
// ---------------------------------------------------------------------------

/**
 * Phase 2 — Gather.
 *
 * Searches daily logs for recent activity and checks for drifted (outdated)
 * memories. Uses the orientation result for drift context.
 */
async function gatherPhase(
  store: MemoryStore,
  config: MemoryPluginConfig,
  client: DreamAgentClient,
  orientResult: unknown,
): Promise<unknown> {
  const memories = await store.list()

  // Find log files from the last 7 days
  const sevenDaysAgo = Date.now() - 7 * MS_PER_DAY
  const recentLogs = memories.filter((m) => {
    if (!m.filename.startsWith("logs/")) return false
    const d = parseLogDate(m.filename)
    return d !== null && d.getTime() >= sevenDaysAgo
  })

  // Read recent log contents
  const logEntries: string[] = []
  for (const log of recentLogs) {
    try {
      const content = await store.read(log.filename)
      const preview = content.length > 2000 ? content.slice(0, 2000) + "\n...(truncated)" : content
      logEntries.push(`--- ${log.filename} ---\n${preview}`)
    } catch {
      logEntries.push(`--- ${log.filename} ---\n(Unable to read)`)
    }
  }

  // Build drift context: for each non-log memory, show filename + description
  const driftContext = memories
    .filter((m) => !m.filename.startsWith("logs/"))
    .map((m) => {
      const desc = m.description ? `: ${m.description}` : ""
      return `- ${m.filename}${desc} (last modified ${new Date(m.mtimeMs).toISOString()})`
    })
    .join("\n")

  const prompt = [
    `You are gathering information for memory consolidation.`,
    ``,
    `## Recent Daily Logs (last 7 days)`,
    logEntries.length > 0
      ? logEntries.join("\n\n")
      : "(no recent log files found)",
    ``,
    `## Drift Check — Memory Descriptions`,
    driftContext || "(no non-log memory files)",
    ``,
    `## Orientation Notes`,
    JSON.stringify(orientResult, null, 2),
    ``,
    `## Task`,
    `Analyze and identify:`,
    `(a) Notable events, decisions, or discoveries from recent logs`,
    `(b) Memories that appear to have drifted — claims that may be outdated`,
    `   based on evidence in the recent logs`,
    `(c) New information from the logs that should be captured as memories`,
    ``,
    `Return as JSON:`,
    `{`,
    `  "logsSummary": "concise summary of recent log activity",`,
    `  "driftedMemories": ["filename.md: why it drifted"],`,
    `  "newInfo": ["information worth capturing as a new memory"]`,
    `}`,
  ].join("\n")

  const session = await client.session.create({
    agent: config.dream.category,
  })
  const response = await client.session.chat(session.id, { message: prompt })
  return parseJsonResponse(response)
}

// ---------------------------------------------------------------------------
// Phase 3 — Consolidate
// ---------------------------------------------------------------------------

/**
 * Phase 3 — Consolidate.
 *
 * Asks the agent to write and update memory files based on orientation and
 * gathered data. The agent returns a JSON payload specifying which files to
 * write (create or overwrite) and which to delete.
 *
 * Writes and deletes are applied inline by this function so subsequent phases
 * see the updated file state.
 */
async function consolidatePhase(
  store: MemoryStore,
  config: MemoryPluginConfig,
  client: DreamAgentClient,
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

  const session = await client.session.create({
    agent: config.dream.category,
  })
  const response = await client.session.chat(session.id, { message: prompt })

  const result = parseJsonResponse(response) as {
    writes?: Array<{ filename: string; content: string }>
    deletes?: string[]
  }

  const writes = result.writes ?? []
  const deletes = result.deletes ?? []

  // Apply writes
  for (const w of writes) {
    // Sanitize filename — prevent path traversal
    const safeFilename = w.filename.replace(/\.\./g, "").replace(/^[/\\]+/, "")
    await store.write(safeFilename, w.content)
  }

  // Apply deletes
  for (const f of deletes) {
    const safeFilename = f.replace(/\.\./g, "").replace(/^[/\\]+/, "")
    try {
      const exists = await store.exists(safeFilename)
      if (exists) {
        await store.delete(safeFilename)
      }
    } catch {
      // File may not exist — ignore
    }
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
 * Sorting order: user → feedback → project → reference → untagged.
 * Within the same type, files are sorted alphabetically by filename.
 */
async function prunePhase(
  store: MemoryStore,
  config: MemoryPluginConfig,
): Promise<void> {
  // Re-scan files after consolidation writes/deletes
  const memories = await scanMemoryFiles(store)

  // Sort by type (canonical order) then filename
  const typeOrder: Record<string, number> = {
    user: 0,
    feedback: 1,
    project: 2,
    reference: 3,
  }

  const sorted = [...memories].sort((a, b) => {
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
 * acquireLock ──► Orient ──► Gather ──► Consolidate ──► Prune ──► releaseLock
 * ```
 *
 * The lock is acquired at the start and **always** released in a `finally`
 * block, even when a phase throws.
 *
 * @param store  - Memory store for all file operations.
 * @param config - Plugin configuration (uses `config.dream` settings).
 * @param client - Agent client for LLM-session creation and chat.
 * @returns Result object with `success` flag, completed `phases` array on
 *          success, or an `error` string on failure.
 *
 * @example
 * ```typescript
 * const result = await runDreamConsolidation(store, config, agentClient)
 * if (result.success) {
 *   console.log(`Completed phases: ${result.phases?.join(" → ")}`)
 * } else {
 *   console.error(`Dream failed: ${result.error}`)
 * }
 * ```
 */
export async function runDreamConsolidation(
  store: MemoryStore,
  config: MemoryPluginConfig,
  client: DreamAgentClient,
): Promise<{ success: boolean; phases?: string[]; error?: string }> {
  const lockPath = getLockPath(store)

  // Step 1: Acquire mutual-exclusion lock
  const acquired = await acquireLock(lockPath, config.dream.lockStaleTimeoutMs)
  if (!acquired) {
    return { success: false, error: "locked" }
  }

  try {
    const phases: string[] = []

    // Phase 1 — Orient
    const orientResult = await orientPhase(store, config, client)
    phases.push("orient")

    // Phase 2 — Gather (depends on orient to identify drift candidates)
    const gatherResult = await gatherPhase(store, config, client, orientResult)
    phases.push("gather")

    // Phase 3 — Consolidate (depends on both orient and gather)
    await consolidatePhase(store, config, client, orientResult, gatherResult)
    phases.push("consolidate")

    // Phase 4 — Prune (reads actual files on disk, no agent needed)
    await prunePhase(store, config)
    phases.push("prune")

    return { success: true, phases }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  } finally {
    await releaseLock(lockPath)
  }
}
