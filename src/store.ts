/**
 * opencode-memory — MemoryStore interface
 *
 * Storage/Runtime decoupling. All memory operations go through this
 * interface. Current implementation: FileSystemStore (Markdown files).
 * Future: SqliteStore, VectorStore, McpRemoteStore.
 *
 * Design principle: the store knows nothing about models, agents, or
 * OpenCode hooks. It is a pure data layer.
 */

import { join, basename, isAbsolute, dirname } from "path"
import { mkdir, readdir, readFile, writeFile, unlink, stat, appendFile, open } from "fs/promises"
import type { MemoryHeader } from "./config.js"
import { isSafePath, checkSymlinkSafe } from "./pathguard.js"
import { parseConfidence } from "./config.js"

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MemoryStore {
  /** List all memory files with their frontmatter headers. */
  list(): Promise<MemoryHeader[]>

  /** Read full content of a memory file. */
  read(filename: string): Promise<string>

  /** Write (create or overwrite) a memory file. */
  write(filename: string, content: string): Promise<void>

  /** Append a line to a memory file (KAIROS daily log mode). */
  append(filename: string, entry: string): Promise<void>

  /** Delete a memory file. */
  delete(filename: string): Promise<void>

  /** Read the MEMORY.md index. Returns null if not exists. */
  getIndex(): Promise<string | null>

  /** Write the MEMORY.md index. */
  updateIndex(content: string): Promise<void>

  /** Check if a file exists. */
  exists(filename: string): Promise<boolean>

  /** Update recall tracking metadata for a memory file. */
  touch(filename: string): Promise<void>

  /** Get the memory directory path. */
  getDir(): string
}

// ---------------------------------------------------------------------------
// Frontmatter parser (reads name/description/type/scope/confidence/schema_version)
// ---------------------------------------------------------------------------

export function parseFrontmatter(
  content: string,
): { name?: string; description?: string; type?: string; scope?: string; confidence?: string; schema_version?: number; recall_count?: number; last_recalled_at?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const yaml = match[1]
  const result: { name?: string; description?: string; type?: string; scope?: string; confidence?: string; schema_version?: number; recall_count?: number; last_recalled_at?: string } = {}
  for (const line of yaml.split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    if (key === "name" || key === "description" || key === "type" || key === "scope" || key === "confidence" || key === "last_recalled_at") {
      (result as Record<string, unknown>)[key] = value.trim()
    } else if (key === "schema_version") {
      result.schema_version = parseInt(value.trim(), 10)
    } else if (key === "recall_count") {
      result.recall_count = parseInt(value.trim(), 10) || 0
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// FileSystemStore implementation
// ---------------------------------------------------------------------------

export const ENTRYPOINT_NAME = "MEMORY.md"

export class FileSystemStore implements MemoryStore {
  private readonly dir: string
  private readonly maxFiles: number
  private readonly frontmatterMaxLines: number

  constructor(dir: string, maxFiles = 200, frontmatterMaxLines = 30) {
    this.dir = dir
    this.maxFiles = maxFiles
    this.frontmatterMaxLines = frontmatterMaxLines
  }

  getDir(): string {
    return this.dir
  }

  async list(): Promise<MemoryHeader[]> {
    try {
      const entries = await readdir(this.dir, { recursive: true })
      const mdFiles = entries.filter(
        (f) => f.endsWith(".md") && basename(f) !== ENTRYPOINT_NAME,
      )

      const results = await Promise.allSettled(
        mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
          const filePath = join(this.dir, relativePath)
          const stats = await stat(filePath)
          // Read only the first few KB for frontmatter (avoid reading entire large files)
          const fh = await open(filePath, "r")
          let fm: { name?: string; description?: string; type?: string; scope?: string; confidence?: string; schema_version?: number; recall_count?: number; last_recalled_at?: string }
          try {
            const buf = Buffer.alloc(4096)
            const { bytesRead } = await fh.read(buf, 0, 4096, 0)
            const content = buf.subarray(0, bytesRead).toString("utf-8")
            const lines = content.split("\n", this.frontmatterMaxLines)
            fm = parseFrontmatter(lines.join("\n"))
          } finally {
            await fh.close()
          }
          return {
            filename: relativePath,
            filePath,
            mtimeMs: stats.mtimeMs,
            description: fm.description || null,
            type: fm.type as MemoryHeader["type"],
            scope: fm.scope as MemoryHeader["scope"],
            confidence: parseConfidence(fm.confidence),
            schemaVersion: fm.schema_version,
            recallCount: fm.recall_count ?? 0,
            lastRecalledAt: fm.last_recalled_at ?? null,
          }
        }),
      )

      return results
        .filter(
          (r): r is PromiseFulfilledResult<MemoryHeader> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, this.maxFiles)
    } catch {
      return []
    }
  }

  async read(filename: string): Promise<string> {
    const filePath = this.resolvePath(filename)
    return readFile(filePath, { encoding: "utf-8" })
  }

  async write(filename: string, content: string): Promise<void> {
    const filePath = this.resolvePath(filename)
    // Security: reject symlinks pointing outside the memory directory
    if (!(await checkSymlinkSafe(filePath, this.dir))) {
      throw new Error(`Symlink safety check failed: ${filename}`)
    }
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, { encoding: "utf-8" })
  }

  async append(filename: string, entry: string): Promise<void> {
    const filePath = this.resolvePath(filename)
    // Create parent dirs if needed
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, entry, { encoding: "utf-8" })
  }

  async delete(filename: string): Promise<void> {
    const filePath = this.resolvePath(filename)
    await unlink(filePath)
  }

  async getIndex(): Promise<string | null> {
    try {
      return await readFile(join(this.dir, ENTRYPOINT_NAME), {
        encoding: "utf-8",
      })
    } catch {
      return null
    }
  }

  async updateIndex(content: string): Promise<void> {
    await writeFile(join(this.dir, ENTRYPOINT_NAME), content, {
      encoding: "utf-8",
    })
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(filename))
      return true
    } catch {
      return false
    }
  }

  /** Resolve a filename to an absolute path within the memory dir. */
  private resolvePath(filename: string): string {
    // Defense-in-depth: pathguard check alongside existing traversal check
    if (!isSafePath(filename, this.dir)) {
      throw new Error(`Path safety check failed: ${filename}`)
    }
    // Legacy check (redundant but explicit)
    if (filename.includes("..") || isAbsolute(filename)) {
      throw new Error(`Path traversal rejected: ${filename}`)
    }
    return join(this.dir, filename)
  }

  async touch(filename: string): Promise<void> {
    const filePath = this.resolvePath(filename)
    try {
      const content = await readFile(filePath, { encoding: "utf-8" })
      const fm = parseFrontmatter(content)
      const currentCount = fm.recall_count ?? 0
      const newCount = currentCount + 1
      const now = new Date().toISOString()

      // Rebuild: strip old frontmatter, prepend updated frontmatter
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
      const lines = ["---"]
      if (fm.name) lines.push(`name: ${fm.name}`)
      if (fm.description) lines.push(`description: ${fm.description}`)
      if (fm.type) lines.push(`type: ${fm.type}`)
      if (fm.scope) lines.push(`scope: ${fm.scope}`)
      if (fm.confidence) lines.push(`confidence: ${fm.confidence}`)
      if (fm.schema_version !== undefined) lines.push(`schema_version: ${fm.schema_version}`)
      lines.push(`recall_count: ${newCount}`)
      lines.push(`last_recalled_at: ${now}`)
      lines.push("---", "")
      await writeFile(filePath, lines.join("\n") + body, { encoding: "utf-8" })
    } catch {
      // File doesn't exist or can't be read — silent
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createStore(
  dir: string,
  options?: { maxFiles?: number; frontmatterMaxLines?: number },
): Promise<MemoryStore> {
  // Ensure directory exists
  await mkdir(dir, { recursive: true })
  return new FileSystemStore(
    dir,
    options?.maxFiles ?? 200,
    options?.frontmatterMaxLines ?? 30,
  )
}

// ---------------------------------------------------------------------------
// Entry-level operations (for multi-entry memory files)
// ---------------------------------------------------------------------------

/** Parse entries from a memory file body. Returns [] if no entry markers. */
export function parseEntries(content: string): Array<{ id: number; body: string }> {
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  const body = fmMatch ? content.slice(fmMatch[0].length) : content
  const entries: Array<{ id: number; body: string }> = []
  const regex = /<!--\s*entry:id=(\d+)\s*-->\r?\n([\s\S]*?)(?=<!--\s*entry:id=|$)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) !== null) {
    entries.push({ id: parseInt(match[1], 10), body: match[2].trim() })
  }
  return entries
}

/** Extract frontmatter string from content. */
function extractFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? match[0] : ""
}

/** Rebuild file: frontmatter + entries with markers. */
function rebuildFile(
  frontmatter: string,
  entries: Array<{ id: number; body: string }>,
): string {
  const body = entries
    .map((e) => `<!-- entry:id=${e.id} -->\n${e.body}`)
    .join("\n\n")
  return `${frontmatter}\n${body}\n`
}

/** Delete a specific entry from a memory file. Falls back to file delete if no markers. */
export async function deleteEntry(
  store: MemoryStore,
  filename: string,
  entryId: number,
): Promise<{ deletedFile: boolean; remainingEntries: number }> {
  const content = await store.read(filename)
  const frontmatter = extractFrontmatter(content)
  const entries = parseEntries(content)

  if (entries.length === 0) {
    await store.delete(filename)
    return { deletedFile: true, remainingEntries: 0 }
  }

  const filtered = entries.filter((e) => e.id !== entryId)
  if (filtered.length === 0) {
    await store.delete(filename)
    return { deletedFile: true, remainingEntries: 0 }
  }
  if (filtered.length === entries.length) {
    throw new Error(`Entry id=${entryId} not found in ${filename}`)
  }
  await store.write(filename, rebuildFile(frontmatter, filtered))
  return { deletedFile: false, remainingEntries: filtered.length }
}
