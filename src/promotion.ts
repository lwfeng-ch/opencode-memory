/**
 * opencode-memory — Promotion Layer
 *
 * Validates and promotes Dream's proposed changes from the staging area
 * (`semantic/staging/`) to long-term memory. Enforces confidence priority
 * rules: lower-confidence memories cannot override higher-confidence ones.
 *
 * Conflict resolution:
 *   - explicit vs explicit → conflict report (manual resolution)
 *   - same level vs same level → merge proposal (stays in staging)
 *   - higher vs lower → promote (replace)
 *   - lower vs higher → reject (discard)
 *   - no existing → promote (new memory)
 *
 * See: docs/specs/2026-07-10-memory-infrastructure-design.md
 *      § Processing Layer → Promotion + Conflict Resolution
 */

import { readdir, readFile, writeFile, mkdir, unlink, rmdir } from "fs/promises"
import { join, basename } from "path"
import type { MemoryStore } from "./store.js"
import type { MemoryPluginConfig } from "./config.js"
import { parseFrontmatter } from "./store.js"
import { getStagingDir, getConflictsDir } from "./paths.js"
import { error as logError } from "./log.js"

// ---------------------------------------------------------------------------
// Confidence priority (enforced by code, not LLM judgment)
// ---------------------------------------------------------------------------

/**
 * Priority map for confidence-based override resolution.
 *
 * Two confidence systems coexist:
 *   - User-facing (config.ts): explicit, inferred, uncertain
 *   - Dream-internal (promotion.ts): explicit, observed, inferred, derived
 *
 * `uncertain` is explicitly mapped to 0 (lowest) so it can be overridden by
 * any Dream-produced memory. Without this entry, `uncertain` would fall
 * through to the `?? 0` fallback in `canOverride` — same result, but the
 * intent would be implicit rather than documented.
 *
 * Priority order: explicit(4) > observed(3) > inferred(2) > derived(1) > uncertain(0)
 */
const CONFIDENCE_PRIORITY: Record<string, number> = {
  explicit: 4,
  observed: 3,
  inferred: 2,
  derived: 1,
  uncertain: 0,
}

/**
 * Check whether a new memory can override an existing one based on confidence.
 *
 * Priority order: explicit > observed > inferred > derived > uncertain
 *
 * @returns `true` if `newConfidence` is strictly higher than `oldConfidence`.
 *          `false` if `newConfidence` is less than or equal to `oldConfidence`.
 */
export function canOverride(oldConfidence: string, newConfidence: string): boolean {
  const oldPriority = CONFIDENCE_PRIORITY[oldConfidence] ?? 0
  const newPriority = CONFIDENCE_PRIORITY[newConfidence] ?? 0
  return newPriority > oldPriority
}

// ---------------------------------------------------------------------------
// V2 frontmatter parser (handles nested confidence.level and source.kind)
// ---------------------------------------------------------------------------

/**
 * Parse frontmatter with nested v2 fields.
 *
 * The existing `parseFrontmatter` in store.ts only handles flat key-value
 * pairs. This parser extends it to extract:
 *   - `confidence.level` (nested under `confidence:`)
 *   - `source.kind` and `source.fact_id` (nested under `source:`)
 *
 * Also handles v1 flat format (`confidence: explicit`) for backward
 * compatibility with existing memories.
 */
function parseV2Frontmatter(content: string): {
  name?: string
  description?: string
  type?: string
  scope?: string
  confidenceLevel?: string
  sourceKind?: string
  factId?: string
  schemaVersion?: number
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}

  const yaml = match[1]
  const result: {
    name?: string
    description?: string
    type?: string
    scope?: string
    confidenceLevel?: string
    sourceKind?: string
    factId?: string
    schemaVersion?: number
  } = {}

  let currentContext: "none" | "confidence" | "source" = "none"

  for (const line of yaml.split(/\r?\n/)) {
    // Top-level key: value
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) {
      const [, key, value] = kv
      if (value === "") {
        // Nested object starts — next indented lines belong to this key
        currentContext =
          key === "confidence"
            ? "confidence"
            : key === "source"
              ? "source"
              : "none"
      } else {
        currentContext = "none"
        if (key === "name" || key === "description" || key === "type" || key === "scope") {
          result[key] = value.trim()
        } else if (key === "confidence") {
          // v1 flat format: confidence: explicit
          result.confidenceLevel = value.trim()
        } else if (key === "schema_version") {
          result.schemaVersion = parseInt(value.trim(), 10)
        }
      }
    } else if (currentContext !== "none") {
      // Nested key: value (indented with spaces)
      const nested = line.match(/^\s+(\w+):\s*(.*)$/)
      if (nested) {
        const [, key, value] = nested
        if (currentContext === "confidence" && key === "level") {
          result.confidenceLevel = value.trim()
        } else if (currentContext === "source") {
          if (key === "kind") result.sourceKind = value.trim()
          else if (key === "fact_id") result.factId = value.trim()
        }
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Index rebuild — regenerate MEMORY.md after promotion
// ---------------------------------------------------------------------------

/**
 * Rebuild the MEMORY.md index from all external memory files.
 *
 * Files in internal directories (`semantic/`, `processing/`, `fact/`,
 * `legacy/`) are excluded — they are pipeline-internal, not user memories.
 *
 * Sorting order: user → feedback → project → reference → untagged.
 * Within the same type, files are sorted alphabetically by filename.
 *
 * Enforces `maxLines` and `maxBytes` caps from config.
 */
async function rebuildMemoryIndex(
  store: MemoryStore,
  config: MemoryPluginConfig,
): Promise<void> {
  const memories = await store.list()

  // Filter out internal directories
  const externalMemories = memories.filter(
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

  const sorted = [...externalMemories].sort((a, b) => {
    const ta = a.type !== undefined ? (typeOrder[a.type] ?? 99) : 99
    const tb = b.type !== undefined ? (typeOrder[b.type] ?? 99) : 99
    if (ta !== tb) return ta - tb
    return a.filename.localeCompare(b.filename)
  })

  // Build index lines: - [Name](filename.md) — description
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
    lines = newIndex.split("\n")
  }

  // Enforce maxBytes cap
  const encoder = new TextEncoder()
  if (encoder.encode(newIndex).length > config.entrypoint.maxBytes) {
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
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Write a conflict report to `semantic/conflicts/` with both versions
 * side by side.
 *
 * Conflict reports are markdown files containing:
 *   - Date and filename
 *   - Staging version (proposed memory)
 *   - Existing version (current memory)
 *   - Resolution note (manual resolution required)
 *
 * The system never auto-overwrites two user-stated facts — it surfaces
 * the contradiction for human review.
 *
 * @param stagingFile  - Absolute path to the staging file.
 * @param existingFile - Absolute path to the existing memory file.
 * @param memoryDir    - Root memory directory (for resolving conflicts dir).
 */
export async function resolveConflict(
  stagingFile: string,
  existingFile: string,
  memoryDir: string,
): Promise<void> {
  const conflictsDir = getConflictsDir(memoryDir)
  await mkdir(conflictsDir, { recursive: true })

  const stagingContent = await readFile(stagingFile, { encoding: "utf-8" })
  let existingContent = "(unable to read existing memory)"
  try {
    existingContent = await readFile(existingFile, { encoding: "utf-8" })
  } catch {
    // Fall back to placeholder — the file may have been removed
  }

  const stagingBasename = basename(stagingFile)
  const dateStr = new Date().toISOString().slice(0, 10)

  const report = [
    "# Memory Conflict Report",
    "",
    `**Date**: ${dateStr}`,
    `**Filename**: ${stagingBasename}`,
    "",
    "## Staging Version (proposed)",
    "",
    "```markdown",
    stagingContent,
    "```",
    "",
    "## Existing Version (current)",
    "",
    "```markdown",
    existingContent,
    "```",
    "",
    "## Resolution",
    "",
    "Both memories have `explicit` confidence. Manual resolution required.",
  ].join("\n")

  const reportPath = join(conflictsDir, `${dateStr}_${stagingBasename}`)
  await writeFile(reportPath, report, { encoding: "utf-8" })
}

// ---------------------------------------------------------------------------
// Main promotion logic
// ---------------------------------------------------------------------------

/**
 * Validate and promote Dream's proposed changes from staging to long-term
 * memory.
 *
 * Flow:
 * 1. Read all `.md` files from `semantic/staging/`
 * 2. For each staging file:
 *    a. Parse frontmatter to get `source.kind` and `confidence.level`
 *    b. Check if a memory with the same filename exists
 *    c. If existing memory exists:
 *       - new < old → REJECT (discard staging file)
 *       - new == old → MERGE PROPOSAL (rename to `merged_` prefix, don't promote)
 *       - new > old → PROMOTE (replace existing)
 *       - both explicit → CONFLICT (write to `semantic/conflicts/`, don't promote)
 *    d. If no existing memory → PROMOTE (write to memory dir)
 * 3. Update MEMORY.md index after all promotions
 * 4. Clean up staging directory
 *
 * @param store     - Memory store for file operations.
 * @param memoryDir - Root memory directory path.
 * @param config    - Plugin configuration (for entrypoint caps).
 * @returns Stats: promoted count, rejected count, conflicts count.
 */
export async function promoteStaging(
  store: MemoryStore,
  memoryDir: string,
  config: MemoryPluginConfig,
): Promise<{ promoted: number; rejected: number; conflicts: number }> {
  const stagingDir = getStagingDir(memoryDir)

  let promoted = 0
  let rejected = 0
  let conflicts = 0

  // 1. Read staging files
  let stagingFiles: string[]
  try {
    stagingFiles = await readdir(stagingDir)
  } catch {
    // Staging dir doesn't exist — nothing to promote
    return { promoted: 0, rejected: 0, conflicts: 0 }
  }

  const mdFiles = stagingFiles.filter((f) => f.endsWith(".md"))

  // 2. Process each staging file
  for (const filename of mdFiles) {
    const stagingPath = join(stagingDir, filename)

    try {
      const content = await readFile(stagingPath, { encoding: "utf-8" })
      const fm = parseV2Frontmatter(content)
      const newConfidence = fm.confidenceLevel ?? "derived"

      // Check if existing memory exists (same filename in memory dir root)
      const exists = await store.exists(filename)

      if (!exists) {
        // 2d. No existing memory → PROMOTE
        await store.write(filename, content)
        await unlink(stagingPath).catch(() => {})
        promoted++
        continue
      }

      // 2c. Existing memory — read and compare confidence
      const existingContent = await store.read(filename)
      const existingFm = parseV2Frontmatter(existingContent)
      const oldConfidence = existingFm.confidenceLevel ?? "inferred"

      // Both explicit → CONFLICT (manual resolution required)
      if (newConfidence === "explicit" && oldConfidence === "explicit") {
        const existingPath = join(memoryDir, filename)
        await resolveConflict(stagingPath, existingPath, memoryDir)
        await unlink(stagingPath).catch(() => {})
        conflicts++
        continue
      }

      // Higher confidence → PROMOTE (replace existing)
      if (canOverride(oldConfidence, newConfidence)) {
        await store.write(filename, content)
        await unlink(stagingPath).catch(() => {})
        promoted++
        continue
      }

      // Same confidence level → MERGE PROPOSAL (keep in staging with prefix)
      if (newConfidence === oldConfidence) {
        const mergedPath = join(stagingDir, `merged_${filename}`)
        await writeFile(mergedPath, content, { encoding: "utf-8" })
        await unlink(stagingPath).catch(() => {})
        // Not promoted — stays as merge proposal for manual review
        rejected++
        continue
      }

      // Lower confidence → REJECT (discard)
      await unlink(stagingPath).catch(() => {})
      rejected++
    } catch (err) {
      logError("memory:promotion", `error processing ${filename}: ${err instanceof Error ? err.message : String(err)}`)
      rejected++
    }
  }

  // 3. Update MEMORY.md index after all promotions
  try {
    await rebuildMemoryIndex(store, config)
  } catch (err) {
    logError("memory:promotion", `failed to rebuild index: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 4. Clean up staging directory (remove if empty — merged_ files remain)
  try {
    const remaining = await readdir(stagingDir)
    if (remaining.length === 0) {
      await rmdir(stagingDir).catch(() => {})
    }
  } catch {
    // Staging dir already removed — ignore
  }

  return { promoted, rejected, conflicts }
}
