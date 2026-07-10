/**
 * opencode-memory — Legacy v1 → v2 schema migration
 *
 * Upgrades pre-v2 memory files to the v2 schema on plugin init.
 * The v2 schema introduces:
 *   - Provenance tracking (source.kind: legacy)
 *   - Nested confidence objects (confidence.level)
 *   - schema_version: 2 marker
 *
 * Design principles:
 *   - Copy, never move — originals backed up to legacy/v1/
 *   - Idempotent — semantic/.migrated marker prevents re-running
 *   - Non-blocking — runs async; failures logged, never thrown
 *   - Zero LLM dependency — pure file I/O
 *
 * See: docs/specs/2026-07-10-memory-infrastructure-design.md §8
 */

import { join } from "path"
import { mkdir, readdir, readFile, writeFile, stat } from "fs/promises"
import { parseFrontmatter, ENTRYPOINT_NAME } from "./store.js"
import { info as logInfo, error as logError } from "./log.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker file placed in semantic/ after successful migration. */
const MIGRATED_MARKER = ".migrated"

// ---------------------------------------------------------------------------
// Schema version detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the memory directory is at schema v1 or v2.
 *
 * - v2: `semantic/.migrated` marker file exists, OR no legacy .md files found
 * - v1: .md files exist directly in memoryDir (not in subdirs, not MEMORY.md)
 *
 * A fresh directory with no .md files is treated as v2 (no migration needed).
 */
export async function detectSchemaVersion(memoryDir: string): Promise<"v1" | "v2"> {
  // Check for migration marker → v2
  const markerPath = join(memoryDir, "semantic", MIGRATED_MARKER)
  try {
    await stat(markerPath)
    return "v2"
  } catch {
    // No marker — fall through to legacy file check
  }

  // Check for .md files directly in memoryDir (not in subdirs, not MEMORY.md) → v1
  try {
    const entries = await readdir(memoryDir, { withFileTypes: true })
    const hasLegacyMd = entries.some(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== ENTRYPOINT_NAME,
    )
    if (hasLegacyMd) return "v1"
  } catch {
    // Directory missing or unreadable — treat as fresh start
  }

  // No legacy .md files → v2 (fresh start)
  return "v2"
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate legacy v1 memory files to the v2 schema.
 *
 * For each .md file (except MEMORY.md) directly in memoryDir:
 *   1. Read content
 *   2. Parse frontmatter (via store.ts parseFrontmatter)
 *   3. Upgrade frontmatter: add source, confidence (nested), schema_version: 2
 *   4. Write upgraded copy to semantic/memories/<filename>
 *   5. Copy original (unmodified) to legacy/v1/<filename>
 *
 * Writes `semantic/.migrated` marker on completion.
 * Originals are never deleted — supports rollback.
 */
export async function migrateLegacyMemory(memoryDir: string): Promise<void> {
  const semanticMemoriesDir = join(memoryDir, "semantic", "memories")
  const legacyV1Dir = join(memoryDir, "legacy", "v1")

  // Create target directories
  await mkdir(semanticMemoriesDir, { recursive: true })
  await mkdir(legacyV1Dir, { recursive: true })

  // Find .md files directly in memoryDir (not subdirs), excluding MEMORY.md
  const entries = await readdir(memoryDir, { withFileTypes: true })
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== ENTRYPOINT_NAME)
    .map((e) => e.name)

  let count = 0
  for (const filename of mdFiles) {
    const srcPath = join(memoryDir, filename)
    const content = await readFile(srcPath, { encoding: "utf-8" })

    // Parse existing frontmatter
    const fm = parseFrontmatter(content)

    // Extract body (content after frontmatter block)
    const body = extractBody(content)

    // Build upgraded v2 frontmatter
    const upgradedFrontmatter = buildV2Frontmatter(fm)

    // Reassemble: new frontmatter + original body
    const upgradedContent = `---\n${upgradedFrontmatter}\n---\n${body}`

    // Write upgraded copy to semantic/memories/
    await writeFile(join(semanticMemoriesDir, filename), upgradedContent, {
      encoding: "utf-8",
    })

    // Copy original (unmodified) to legacy/v1/ for backup
    await writeFile(join(legacyV1Dir, filename), content, { encoding: "utf-8" })

    count++
  }

  // Write migration marker with timestamp
  const markerPath = join(memoryDir, "semantic", MIGRATED_MARKER)
  const markerContent = JSON.stringify(
    {
      migrated_at: new Date().toISOString(),
      file_count: count,
    },
    null,
    2,
  )
  await writeFile(markerPath, markerContent, { encoding: "utf-8" })

  logInfo("memory:migration", `migrated ${count} files from v1 to v2`)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run migration if the memory directory is at v1 schema.
 *
 * Safe to call on every plugin init — idempotent. Never throws:
 * failures are logged to console.error and swallowed.
 */
export async function runMigrationIfNeeded(memoryDir: string): Promise<void> {
  try {
    const version = await detectSchemaVersion(memoryDir)

    if (version === "v2") {
      logInfo("memory:migration", "already migrated, skipping")
      return
    }

    await migrateLegacyMemory(memoryDir)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logError("memory:migration", `failed: ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Extract the body content following the YAML frontmatter block.
 * Uses \r?\n to handle both LF and CRLF line endings (Windows fix).
 * If no frontmatter is present, returns the original content unchanged.
 */
function extractBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

/**
 * Build v2 frontmatter string from parsed v1 fields.
 *
 * Preserves existing values: name, description, type, scope, confidence.
 * Adds v2 fields: source (legacy provenance), schema_version: 2.
 * Converts confidence from flat string to nested { level: <value> } format.
 * Defaults confidence level to "explicit" when not present in the original.
 */
function buildV2Frontmatter(fm: {
  name?: string
  description?: string
  type?: string
  scope?: string
  confidence?: string
}): string {
  const lines: string[] = []

  // Preserve existing scalar fields
  if (fm.name) lines.push(`name: ${fm.name}`)
  if (fm.description) lines.push(`description: ${fm.description}`)
  if (fm.type) lines.push(`type: ${fm.type}`)
  if (fm.scope) lines.push(`scope: ${fm.scope}`)

  // Confidence: convert flat string → nested object.
  // Preserve existing value; default to "explicit" for files without confidence.
  const confidenceLevel = fm.confidence || "explicit"
  lines.push("confidence:")
  lines.push(`  level: ${confidenceLevel}`)

  // Source: mark as legacy migration (provenance tracking)
  lines.push("source:")
  lines.push("  kind: legacy")
  lines.push("  fact_id: null")

  // Schema version marker
  lines.push("schema_version: 2")

  return lines.join("\n")
}
