/**
 * opencode-memory — Repair Service (v0.3.3 + v0.3.4 Phase 0)
 *
 * Executes repair actions on memory files:
 * - archive(): set frontmatter status=archived (metadata, NOT file move)
 *   v0.3.4: also updates ARCHIVE.md + MEMORY.md manifests atomically
 *   (manifest-pair-first, frontmatter-last — see R2 atomicity protocol)
 * - delete(): remove file from store + audit log (human approve only)
 * - restore(): set frontmatter status=active (undo archive)
 *   v0.3.4: also updates manifests + conflict detection (R3)
 *
 * All actions are logged in audit log.
 */

import { join } from "node:path"
import { readFile, writeFile, unlink, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { AuditLog } from "./audit.js"
import { generateActionId, type RepairAction, type RepairCandidate } from "./candidate.js"
import { parseFrontmatter } from "../store.js"
import { addEntry, removeEntry, readArchive, writeArchive } from "../index/archive-index.js"
import { extractKeywords, jaccardSimilarity } from "../evaluation/fingerprint.js"

export class RepairService {
  constructor(
    private memoryDir: string,
    private auditLog: AuditLog,
    /**
     * v0.3.4: when true, archive/restore also sync MEMORY.md + ARCHIVE.md
     * manifests. When false (default), v0.3.3 behavior — frontmatter only.
     * Should mirror config.experimental.archiveIndex.
     */
    private archiveIndexEnabled: boolean = false,
  ) {}

  async archive(filename: string, reason: string, candidateId?: string): Promise<void> {
    const filepath = join(this.memoryDir, filename)
    try {
      if (!existsSync(filepath)) {
        throw new Error(`File not found: ${filename}`)
      }
      const originalContent = await readFile(filepath, "utf-8")

      // Phase 1 — Prepare: build all outputs in memory
      const updatedContent = this.setFrontmatterField(originalContent, {
        status: "archived",
        archivedAt: Date.now(),
      })
      const fm = parseFrontmatter(originalContent)
      const title = fm.name ?? filename
      const description = fm.description ?? ""

      // Phase 2 — Atomic swap: manifest pair FIRST, then frontmatter (R2 protocol)
      // Rationale: if manifest pair succeeds but frontmatter fails, manifests are
      // consistent with each other — rebuildIndex() auto-recovers by re-adding
      // file to MEMORY.md (frontmatter still says active). Recoverable.
      // If frontmatter-first but manifest fails: orphaned archived entry in active
      // manifest. Harder to recover.
      if (this.archiveIndexEnabled) {
        try {
          // 2a. Add to ARCHIVE.md (lazy-create if needed)
          await addEntry(this.memoryDir, {
            filename,
            title,
            description,
            archivedAt: Date.now(),
          })
          // 2b. Remove from MEMORY.md (full rebuild to keep idempotent)
          // Note: This calls into promotion.ts's rebuildMemoryIndex logic, but
          // we don't have access to the store instance here. Instead, we use
          // a targeted approach: read MEMORY.md, find the line, remove it.
          await this.removeEntryFromMemoryMd(filename)
        } catch (manifestErr) {
          // Manifest write failed — rollback (delete ARCHIVE.md if newly created)
          // and DO NOT write frontmatter. Audit log records rollback.
          await this.rollbackArchiveManifests(filename)
          const action: RepairAction = {
            id: generateActionId(),
            type: "archive",
            filename,
            timestamp: Date.now(),
            approvedBy: "cli",
            reason,
            candidateId,
            result: "failure",
            error: `manifest sync failed (rolled back): ${manifestErr instanceof Error ? manifestErr.message : String(manifestErr)}`,
          }
          await this.auditLog.log(action)
          throw manifestErr
        }
      }

      // Phase 3 — Write frontmatter (last — recoverable if manifests succeeded)
      await writeFile(filepath, updatedContent, "utf-8")

      const action: RepairAction = {
        id: generateActionId(),
        type: "archive",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        candidateId,
        result: "success",
      }
      await this.auditLog.log(action)
    } catch (err) {
      const action: RepairAction = {
        id: generateActionId(),
        type: "archive",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        candidateId,
        result: "failure",
        error: err instanceof Error ? err.message : String(err),
      }
      await this.auditLog.log(action)
      throw err
    }
  }

  async delete(filename: string, reason: string, candidateId?: string): Promise<void> {
    const filepath = join(this.memoryDir, filename)
    try {
      if (!existsSync(filepath)) {
        throw new Error(`File not found: ${filename}`)
      }
      await unlink(filepath)

      const action: RepairAction = {
        id: generateActionId(),
        type: "delete",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        candidateId,
        result: "success",
      }
      await this.auditLog.log(action)
    } catch (err) {
      const action: RepairAction = {
        id: generateActionId(),
        type: "delete",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        candidateId,
        result: "failure",
        error: err instanceof Error ? err.message : String(err),
      }
      await this.auditLog.log(action)
      throw err
    }
  }

  async restore(filename: string, reason: string = "manual restore"): Promise<void> {
    const filepath = join(this.memoryDir, filename)
    try {
      if (!existsSync(filepath)) {
        throw new Error(`File not found: ${filename}`)
      }

      // R3: Conflict detection BEFORE restore (Phase 0 fallback using fingerprint.ts)
      // If a similar active memory exists, restore may produce a duplicate.
      const restoredContent = await readFile(filepath, "utf-8")
      // Strip frontmatter to compare bodies
      const restoredBody = restoredContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
      const restoredKeywords = new Set(extractKeywords(restoredBody))

      let conflictOutcome: "restore-candidate" | "merge-candidate" | "conflict" = "restore-candidate"
      let maxSim = 0
      let conflictFilename = ""
      if (restoredKeywords.size > 0) {
        const files = await readdir(this.memoryDir).catch(() => [] as string[])
        for (const f of files) {
          if (!f.endsWith(".md") || f === filename || f === "MEMORY.md" || f === "ARCHIVE.md") continue
          const fPath = join(this.memoryDir, f)
          try {
            const content = await readFile(fPath, "utf-8")
            // Skip other archived files — only check against ACTIVE memories
            const fm = parseFrontmatter(content)
            if (fm.status === "archived") continue
            const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
            const sim = jaccardSimilarity(restoredKeywords, new Set(extractKeywords(body)))
            if (sim > maxSim) {
              maxSim = sim
              conflictFilename = f
            }
          } catch {
            // skip unreadable
          }
        }
      }
      if (maxSim >= 0.8) conflictOutcome = "conflict"
      else if (maxSim >= 0.6) conflictOutcome = "merge-candidate"

      // R3: BLOCK restore on conflict (sim >= 0.8)
      if (conflictOutcome === "conflict") {
        const action: RepairAction = {
          id: generateActionId(),
          type: "restore",
          filename,
          timestamp: Date.now(),
          approvedBy: "cli",
          reason,
          result: "failure",
          error: `conflict: similarity ${maxSim.toFixed(2)} with active file ${conflictFilename} (>= 0.8 threshold) — manual resolution required`,
        }
        await this.auditLog.log(action)
        throw new Error(`Restore blocked: conflict with ${conflictFilename} (similarity ${maxSim.toFixed(2)})`)
      }

      // Proceed with restore
      const updatedContent = this.setFrontmatterField(restoredContent, {
        status: "active",
        archivedAt: null,
      })
      const fm = parseFrontmatter(restoredContent)
      const title = fm.name ?? filename
      const description = fm.description ?? ""

      // Manifest sync: remove from ARCHIVE.md, add back to MEMORY.md
      if (this.archiveIndexEnabled) {
        await removeEntry(this.memoryDir, filename)
        await this.addEntryToMemoryMd(filename, title, description)
        // Lazy-delete ARCHIVE.md if empty (writeArchive handles this when called with [])
        const remaining = await readArchive(this.memoryDir)
        if (remaining.length === 0) {
          await writeArchive(this.memoryDir, [])
        }
      }

      await writeFile(filepath, updatedContent, "utf-8")

      const action: RepairAction = {
        id: generateActionId(),
        type: "restore",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        result: "success",
        error: conflictOutcome === "merge-candidate"
          ? `merge-candidate: similarity ${maxSim.toFixed(2)} with ${conflictFilename} (0.6-0.8) — restored but flagged for manual review`
          : undefined,
      }
      await this.auditLog.log(action)
    } catch (err) {
      const action: RepairAction = {
        id: generateActionId(),
        type: "restore",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        result: "failure",
        error: err instanceof Error ? err.message : String(err),
      }
      await this.auditLog.log(action)
      throw err
    }
  }

  async getAuditLog(): Promise<RepairAction[]> {
    return this.auditLog.getAll()
  }

  async executeCandidate(candidate: RepairCandidate): Promise<void> {
    if (candidate.action === "archive") {
      await this.archive(candidate.source, candidate.reason, candidate.id)
    } else if (candidate.action === "delete") {
      await this.delete(candidate.source, candidate.reason, candidate.id)
    }
  }

  // ---------------------------------------------------------------------------
  // v0.3.4 helpers — MEMORY.md targeted entry manipulation
  // ---------------------------------------------------------------------------

  /**
   * Remove a single entry from MEMORY.md by filename (targeted, not full rebuild).
   * Idempotent: no-op if filename not in manifest.
   */
  private async removeEntryFromMemoryMd(filename: string): Promise<void> {
    const memoryPath = join(this.memoryDir, "MEMORY.md")
    if (!existsSync(memoryPath)) return
    const content = await readFile(memoryPath, "utf-8")
    const lines = content.split(/\r?\n/)
    const filtered = lines.filter(line => {
      // Match `- [Title](filename) — desc` or `- [Title](filename)`
      const m = line.match(/^-\s+\[[^\]]*\]\(([^)]+)\)/)
      return !m || m[1] !== filename
    })
    if (filtered.length === lines.length) return // no change
    await writeFile(memoryPath, filtered.join("\r\n") + (filtered.length > 0 ? "\r\n" : ""), "utf-8")
  }

  /**
   * Add an entry back to MEMORY.md (used by restore).
   * Format: `- [title](filename) — description`
   * If description is empty, omit the em-dash separator.
   */
  private async addEntryToMemoryMd(filename: string, title: string, description: string): Promise<void> {
    const memoryPath = join(this.memoryDir, "MEMORY.md")
    let content = ""
    if (existsSync(memoryPath)) {
      content = await readFile(memoryPath, "utf-8")
    }
    const desc = description.trim()
    const newLine = desc
      ? `- [${title}](${filename}) — ${desc}`
      : `- [${title}](${filename})`
    // Avoid duplicate if entry already exists — match manifest line pattern
    // Matches `- [Any Title](filename) — desc` or `- [Any Title](filename)`
    const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`\\]\\(${escapedFilename}\\)`).test(content)) return
    // Append at end (preserves any existing ordering)
    content = content.trimEnd() + (content ? "\r\n" : "") + newLine + "\r\n"
    await writeFile(memoryPath, content, "utf-8")
  }

  /**
   * Rollback: remove a just-added entry from ARCHIVE.md if manifest write failed.
   * Used when archive() Phase 2 (manifest sync) fails after ARCHIVE.md was
   * already written — we need to undo the partial state.
   */
  private async rollbackArchiveManifests(filename: string): Promise<void> {
    try {
      await removeEntry(this.memoryDir, filename)
    } catch {
      // Best-effort rollback — silent failure here is OK, audit log already
      // records the rollback attempt.
    }
  }

  /**
   * Set a frontmatter field in markdown content.
   * If the field doesn't exist, it's added.
   * If it exists, it's replaced.
   */
  private setFrontmatterField(content: string, fields: Record<string, unknown>): string {
    // Split into frontmatter and body
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
    if (!fmMatch) {
      // No frontmatter — create one
      const newFm = Object.entries(fields)
        .map(([k, v]) => `${k}: ${v === null ? "null" : typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n")
      return `---\r\n${newFm}\r\n---\r\n${content}`
    }

    let fm = fmMatch[1]
    const body = fmMatch[2]

    for (const [key, value] of Object.entries(fields)) {
      const valueStr = value === null ? "null" : typeof value === "string" ? value : JSON.stringify(value)
      const fieldRegex = new RegExp(`^${key}:.*$`, "m")
      if (fieldRegex.test(fm)) {
        fm = fm.replace(fieldRegex, `${key}: ${valueStr}`)
      } else {
        fm += `\n${key}: ${valueStr}`
      }
    }

    return `---\r\n${fm}\r\n---\r\n${body}`
  }
}
