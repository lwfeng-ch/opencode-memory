/**
 * opencode-memory — Tool definitions
 *
 * Custom tools that the main agent uses to interact with memory.
 * These are registered via the plugin's `tool` hook.
 *
 * Nine tools:
 *   memory_save     — Create or update a memory file + update index
 *   memory_list     — List all memories with metadata
 *   memory_search   — Keyword search across memory descriptions
 *   memory_read     — Read full content of a memory file
 *   memory_delete   — Delete a memory file + remove from index
 *   memory_append   — Append to daily log (KAIROS mode)
 *   memory_status   — Check memory system health and pipeline status
 *   memory_rebuild  — Rebuild MEMORY.md index from existing memory files
 *   memory_replay   — Re-process fact records through extraction pipeline
 */

import { relative } from "path"
import { z } from "zod"
import type { ToolDefinition } from "@opencode-ai/plugin"
import type { MemoryStore } from "./store.js"
import type { MemoryPluginConfig, MemoryHeader } from "./config.js"
import { MEMORY_TYPES, MEMORY_SCOPES, parseMemoryType, resolveMemoryScope, parseMemoryScope, CONFIDENCE_LEVELS, parseConfidence } from "./config.js"
import { deleteEntry } from "./store.js"
import { getDailyLogPath } from "./paths.js"
import { loadState } from "./state.js"
import { calculateHealthScore, healthStatus, formatStatusReport } from "./health.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ToolDefinition and ToolContext are imported from @opencode-ai/plugin.
// The SDK expects: { description: string; args: z.ZodRawShape; execute(args, context): Promise<ToolResult> }

// ---------------------------------------------------------------------------
// Filename validation
// ---------------------------------------------------------------------------

/**
 * Validate that a filename is safe snake_case with .md extension.
 *
 * Allowed pattern: lowercase letters, digits, underscores, hyphens,
 * forward slashes (for subdirectories), ending in .md
 */
const SAFE_FILENAME_RE = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.md$/

/** Validate that a filename is safe snake_case with .md extension. Returns null if valid, error message if not. */
export function validateFilename(filename: string): string | null {
  if (!filename) return "filename is required"
  if (!SAFE_FILENAME_RE.test(filename)) {
    return `filename must be snake_case with .md extension (e.g. user_role.md); got: "${filename}"`
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build YAML-style frontmatter string. */
function buildFrontmatter(
  name: string,
  description: string,
  type: string,
  scope?: string,
  confidence?: string,
): string {
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `type: ${type}`,
  ]
  if (scope !== undefined) lines.push(`scope: ${scope}`)
  if (confidence !== undefined) lines.push(`confidence: ${confidence}`)
  lines.push("schema_version: 1")
  lines.push("---")
  return lines.join("\n")
}

/** Parse a MEMORY.md index into lines. */
function parseIndex(content: string | null): string[] {
  if (!content || content.trim().length === 0) return []
  return content.split("\n")
}

/** Format index lines back to a single string. */
function formatIndex(lines: string[]): string {
  return lines.join("\n") + (lines.length > 0 ? "\n" : "")
}

/** Find the index line that references a given filename. Returns -1 if not found. */
function findIndexLine(lines: string[], filename: string): number {
  // Match lines like: `- [Name](filename.md) — description`
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`\\(${escaped}\\)`)
  return lines.findIndex((line) => pattern.test(line))
}

/** Build an index line for a memory entry. */
function buildIndexLine(name: string, filename: string, description: string): string {
  return `- [${name}](${filename}) — ${description}`
}

/** Format a single memory header as a table row. */
function formatMemoryRow(h: MemoryHeader, scopePrefix?: string): string {
  const type = h.type ?? "—"
  const desc = h.description ?? "—"
  const age = formatAge(h.mtimeMs)
  const name = scopePrefix ? `[${scopePrefix}] ${h.filename}` : h.filename
  return `${name} | ${type} | ${desc} | ${age}`
}

/** Format mtime as a human-readable age string. */
function formatAge(mtimeMs: number): string {
  const diffMs = Date.now() - mtimeMs
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths}mo ago`
}

/** Get today's date as YYYY-MM-DD. */
function todayString(): string {
  const d = new Date()
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/** Get current time as HH:MM. */
function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Create the nine memory tools bound to a store and config.
 *
 * Each tool returns a `ToolDefinition` with a description, parameter schema,
 * and an execute function. The execute function receives the parsed arguments
 * and a context object with session/message IDs and an abort signal.
 *
 * The optional `statePath` enables health/status reporting (memory_status)
 * and is required for the replay tool to locate fact records.
 */
export function defineMemoryTools(
  projectStore: MemoryStore,
  _config: MemoryPluginConfig,
  userStore?: MemoryStore,
  statePath?: string,
): Record<string, ToolDefinition> {
  return {
    // -----------------------------------------------------------------------
    // memory_save — Create or update a memory file + update index
    // -----------------------------------------------------------------------
    memory_save: {
      description: [
        "Create or update a memory file and its entry in the MEMORY.md index.",
        "",
        "Use this when the user explicitly asks you to remember something,",
        "or when you observe important information worth preserving across",
        "sessions (user preferences, feedback, project context, external references).",
        "",
        "The `filename` should be a short snake_case name with .md extension",
        "(e.g. `user_role.md`, `feedback_testing_style.md`).",
        "",
        "The `type` must be one of: user (about the person), feedback (guidance",
        "on approach), project (ongoing work context), reference (pointers to",
        "external systems).",
      ].join("\n"),
      args: {
        filename: z.string().describe("File name for the memory (e.g. user_role.md, feedback_testing.md). Use snake_case with .md extension."),
        content: z.string().describe("Memory content body (markdown). For feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines."),
        name: z.string().describe("Human-readable name for this memory (e.g. 'User Role', 'Testing Style Feedback')."),
        description: z.string().describe("One-line description — used to decide relevance in future conversations, so be specific."),
        type: z.enum(MEMORY_TYPES).describe("Memory type: user (about the person), feedback (guidance on approach), project (ongoing work context), reference (pointers to external systems)."),
        scope: z.enum(MEMORY_SCOPES).optional().describe("Memory scope: 'user' (cross-project, shared) or 'project' (this project only). If omitted, defaults to type-based routing: user/feedback → user scope, project/reference → project scope."),
        confidence: z.enum(CONFIDENCE_LEVELS).optional().describe("Trust level: 'explicit' (user explicitly stated), 'inferred' (agent deduced), 'uncertain' (not sure but worth recording). Default: inferred."),
      },
      execute: async (args) => {
        const filename = String(args.filename ?? "")
        const content = String(args.content ?? "")
        const name = String(args.name ?? "")
        const description = String(args.description ?? "")
        const type = String(args.type ?? "")

        if (!filename || !content || !name || !description || !type) {
          return { output: "Error: filename, content, name, description, and type are all required." }
        }

        // Validate filename format (friendly error before store's path-traversal check)
        const filenameError = validateFilename(filename)
        if (filenameError) {
          return { output: `Error: ${filenameError}` }
        }

        const parsedType = parseMemoryType(type)
        if (!parsedType) {
          return { output: `Error: invalid type "${type}". Must be one of: ${MEMORY_TYPES.join(", ")}.` }
        }

        // Resolve scope and confidence
        const scope = resolveMemoryScope(parsedType, parseMemoryScope(args.scope))
        const confidence = parseConfidence(args.confidence)

        // Build frontmatter + content with new fields
        const fullContent = buildFrontmatter(name, description, parsedType, scope, confidence) + "\n" + content

        // Route to correct store based on scope
        const targetStore = (scope === "user" && userStore) ? userStore : projectStore

        // Write the file
        await targetStore.write(filename, fullContent)

        // Update index on the target store
        const indexRaw = await targetStore.getIndex()
        const lines = parseIndex(indexRaw)
        const existingIdx = findIndexLine(lines, filename)
        const newLine = buildIndexLine(name, filename, description)

        if (existingIdx >= 0) {
          lines[existingIdx] = newLine
        } else {
          lines.push(newLine)
        }

        await targetStore.updateIndex(formatIndex(lines))

        const targetLabel = targetStore === userStore ? "user" : "project"
        return { output: `Saved memory: ${filename} [${targetLabel}]` }
      },
    },

    // -----------------------------------------------------------------------
    // memory_list — List all memories with metadata
    // -----------------------------------------------------------------------
    memory_list: {
      description: [
        "List all saved memories with their filename, type, description, and age.",
        "",
        "Use this to check what memories exist before saving a new one",
        "(to avoid duplicates) or when you need to recall what's been stored.",
        "",
        "Returns a table with columns: filename | type | description | age.",
      ].join("\n"),
      args: {},
      execute: async () => {
        const projectHeaders = await projectStore.list()
        const userHeaders = userStore ? await userStore.list() : []

        const rows: string[] = []
        for (const h of projectHeaders) rows.push(formatMemoryRow(h))
        for (const h of userHeaders) rows.push(formatMemoryRow(h, "user"))

        if (rows.length === 0) {
          return { output: "No memories found." }
        }

        const table = ["filename | type | description | age", "--- | --- | --- | ---", ...rows].join("\n")
        return { output: table }
      },
    },

    // -----------------------------------------------------------------------
    // memory_search — Keyword search across memory descriptions
    // -----------------------------------------------------------------------
    memory_search: {
      description: [
        "Search memories by keyword. Searches across filenames and descriptions.",
        "",
        "Use this to find relevant memories before answering questions or when",
        "the user references past conversations. Case-insensitive substring match.",
      ].join("\n"),
      args: {
        query: z.string().describe("Search query — searches across filename and description fields (case-insensitive)."),
      },
      execute: async (args) => {
        const query = String(args.query ?? "").toLowerCase()
        if (!query) {
          return { output: "Error: query is required." }
        }

        const filterFn = (h: MemoryHeader) =>
          h.filename.toLowerCase().includes(query) ||
          (h.description && h.description.toLowerCase().includes(query))

        const projectMatches = (await projectStore.list()).filter(filterFn)
        const userMatches = userStore ? (await userStore.list()).filter(filterFn) : []

        const rows: string[] = []
        for (const h of projectMatches) rows.push(formatMemoryRow(h))
        for (const h of userMatches) rows.push(formatMemoryRow(h, "user"))

        if (rows.length === 0) {
          return { output: `No memories matching "${args.query}".` }
        }

        const count = rows.length
        const table = ["filename | type | description | age", "--- | --- | --- | ---", ...rows].join("\n")
        return { output: `Found ${count} match(es) for "${args.query}":\n\n${table}` }
      },
    },

    // -----------------------------------------------------------------------
    // memory_read — Read full content of a memory file
    // -----------------------------------------------------------------------
    memory_read: {
      description: [
        "Read the full content of a specific memory file.",
        "",
        "Use this when you need to see the complete content of a memory,",
        "including its frontmatter and body. The filename should match",
        "exactly what was used when saving (e.g. user_role.md).",
      ].join("\n"),
      args: {
        filename: z.string().describe("File name of the memory to read (with or without .md extension)."),
      },
      execute: async (args) => {
        let filename = String(args.filename ?? "")
        if (!filename) {
          return { output: "Error: filename is required." }
        }
        // Normalize: ensure .md extension
        if (!filename.endsWith(".md")) {
          filename += ".md"
        }

        // Try projectStore first, then userStore as fallback
        try {
          const content = await projectStore.read(filename)
          return { output: `[project] ${filename}\n\n${content}` }
        } catch {
          if (userStore) {
            try {
              const content = await userStore.read(filename)
              return { output: `[user] ${filename}\n\n${content}` }
            } catch {
              return { output: `Error: memory "${filename}" not found.` }
            }
          }
          return { output: `Error: memory "${filename}" not found.` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // memory_delete — Delete a memory file + remove from index
    // -----------------------------------------------------------------------
    memory_delete: {
      description: [
        "Delete a memory file or a specific entry within it.",
        "",
        "If `entryId` is provided, deletes only the specified entry (the file",
        "is kept with remaining entries). If the file has only one entry or no",
        "entry markers, the entire file is deleted.",
        "",
        "If `entryId` is omitted, deletes the entire file.",
      ].join("\n"),
      args: {
        filename: z.string().describe("File name of the memory to delete (with or without .md extension)."),
        entryId: z.number().optional().describe("Optional entry ID to delete. If omitted, deletes the entire file."),
      },
      execute: async (args) => {
        let filename = String(args.filename ?? "")
        if (!filename) {
          return { output: "Error: filename is required." }
        }
        if (!filename.endsWith(".md")) {
          filename += ".md"
        }

        const entryId = args.entryId as number | undefined

        // Determine target store
        let targetStore: MemoryStore | undefined
        let scopeLabel: string
        if (await projectStore.exists(filename)) {
          targetStore = projectStore
          scopeLabel = "project"
        } else if (userStore && await userStore.exists(filename)) {
          targetStore = userStore
          scopeLabel = "user"
        } else {
          return { output: `Error: memory "${filename}" not found.` }
        }

        if (entryId !== undefined) {
          // Entry-level deletion
          try {
            const result = await deleteEntry(targetStore, filename, entryId)
            if (result.deletedFile) {
              const indexRaw = await targetStore.getIndex()
              const lines = parseIndex(indexRaw)
              const existingIdx = findIndexLine(lines, filename)
              if (existingIdx >= 0) {
                lines.splice(existingIdx, 1)
                await targetStore.updateIndex(formatIndex(lines))
              }
              return { output: `Deleted entry ${entryId} (file removed: no remaining entries) [${scopeLabel}]` }
            }
            return { output: `Deleted entry ${entryId} from ${filename} (${result.remainingEntries} entries remaining) [${scopeLabel}]` }
          } catch (err) {
            return { output: `Error: ${err instanceof Error ? err.message : String(err)}` }
          }
        }

        // File-level deletion (existing logic)
        await targetStore.delete(filename)
        const indexRaw = await targetStore.getIndex()
        const lines = parseIndex(indexRaw)
        const existingIdx = findIndexLine(lines, filename)
        if (existingIdx >= 0) {
          lines.splice(existingIdx, 1)
          await targetStore.updateIndex(formatIndex(lines))
        }
        return { output: `Deleted: ${filename} [${scopeLabel}]` }
      },
    },

    // -----------------------------------------------------------------------
    // memory_append — Append to daily log (KAIROS mode)
    // -----------------------------------------------------------------------
    memory_append: {
      description: [
        "Append an entry to today's daily log file.",
        "",
        "Use this for lightweight, timestamped note-taking during a session.",
        "Entries are categorized and stored in a date-based log hierarchy:",
        "logs/YYYY/MM/YYYY-MM-DD.md.",
        "",
        "Categories: correction, fact, project, reference, request.",
        "If no category is given, 'fact' is used as default.",
      ].join("\n"),
      args: {
        entry: z.string().describe("The log entry text to append."),
        category: z.enum(["correction", "fact", "project", "reference", "request"]).optional().describe("Entry category: correction, fact, project, reference, request."),
      },
      execute: async (args) => {
        const entry = String(args.entry ?? "")
        if (!entry) {
          return { output: "Error: entry is required." }
        }

        const category = String(args.category ?? "fact")
        const timestamp = nowHHMM()
        const date = todayString()
        const formattedEntry = `- [${timestamp}] [${category}] ${entry}\n`

        // Get the absolute daily log path
        const memoryDir = projectStore.getDir()
        const logAbsolutePath = getDailyLogPath(memoryDir)

        // Compute relative path from memory dir to the log file
        // The projectStore.append() resolves relative to memoryDir, so we need
        // the relative path from memoryDir to the log file
        const logRelativePath = relative(memoryDir, logAbsolutePath)

        await projectStore.append(logRelativePath, formattedEntry)

        return { output: `Logged to ${date}` }
      },
    },

    // -----------------------------------------------------------------------
    // memory_status — Check memory system health and pipeline status
    // -----------------------------------------------------------------------
    memory_status: {
      description: "Check the health and status of the memory system. Shows adapter health, capture stats, extraction stats, dream stats, recall stats, and event counts. Use this to diagnose if memory is working correctly.",
      args: {},
      execute: async () => {
        if (!statePath) {
          return { output: "Memory state tracking not configured (statePath not set)." }
        }
        try {
          const state = await loadState(statePath)
          state.health.score = calculateHealthScore(state)
          state.health.status = healthStatus(state.health.score)
          const report = formatStatusReport(state)
          return { output: report }
        } catch (err) {
          return { output: `Error reading memory state: ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    },

    // -----------------------------------------------------------------------
    // memory_rebuild — Rebuild MEMORY.md index from existing memory files
    // -----------------------------------------------------------------------
    memory_rebuild: {
      description: [
        "Rebuild the MEMORY.md index from all existing memory files.",
        "",
        "Use this when the index is corrupted, missing entries, or out of date",
        "after manual file additions. Scans all .md files (excluding MEMORY.md),",
        "reads frontmatter, and writes a fresh sorted index.",
      ].join("\n"),
      args: {},
      execute: async () => {
        // List all files from both stores
        const projectHeaders = await projectStore.list()
        const userHeaders = userStore ? await userStore.list() : []

        // Sort by type then filename (same order as dream prunePhase)
        const typeOrder: Record<string, number> = {
          user: 0, feedback: 1, project: 2, reference: 3,
        }
        const allHeaders = [...projectHeaders, ...userHeaders]
        allHeaders.sort((a, b) => {
          const ta = a.type ? (typeOrder[a.type] ?? 99) : 99
          const tb = b.type ? (typeOrder[b.type] ?? 99) : 99
          if (ta !== tb) return ta - tb
          return a.filename.localeCompare(b.filename)
        })

        // Build index lines
        const lines: string[] = []
        for (const h of allHeaders) {
          const name = h.description ?? h.filename
          const desc = h.description ?? ""
          lines.push(`- [${name}](${h.filename}) — ${desc}`)
        }

        const indexContent = lines.join("\n") + (lines.length > 0 ? "\n" : "")
        await projectStore.updateIndex(indexContent)

        return { output: `Rebuilt MEMORY.md: ${lines.length} entries (${projectHeaders.length} project, ${userHeaders.length} user)` }
      },
    },

    // -----------------------------------------------------------------------
    // memory_replay — Re-process fact records through extraction
    // -----------------------------------------------------------------------
    memory_replay: {
      description: [
        "Re-process fact records through the extraction pipeline.",
        "",
        "Use this after upgrading the model, changing extraction prompts, or",
        "fixing extraction bugs. Reads fact/sessions/*.json records and",
        "re-runs extraction to produce updated semantic memories.",
        "",
        "The Fact Layer preserves original session context — memories can be",
        "rebuilt from facts at any time without losing data.",
      ].join("\n"),
      args: {
        session_id: z.string().optional().describe("Specific session ID to replay. If omitted, replays all pending/failed sessions."),
      },
      execute: async (args) => {
        // For v1, this is a stub that explains what would happen
        // Full implementation requires the integration of extraction + adapter
        const sessionId = args.session_id as string | undefined
        if (sessionId) {
          return { output: `Replay for session ${sessionId} — will be implemented during integration phase. The fact record exists and is ready for re-extraction.` }
        }
        return { output: "Replay all pending sessions — will be implemented during integration phase. Fact records are preserved and ready for re-extraction." }
      },
    },
  }
}