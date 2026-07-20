/**
 * opencode-memory — Repair Service (v0.3.3)
 *
 * Executes repair actions on memory files:
 * - archive(): set frontmatter status=archived (metadata, NOT file move)
 * - delete(): remove file from store + audit log (human approve only)
 * - restore(): set frontmatter status=active (undo archive)
 *
 * All actions are logged in audit log.
 */

import { join } from "node:path"
import { readFile, writeFile, unlink } from "node:fs/promises"
import { existsSync } from "node:fs"
import { AuditLog } from "./audit.js"
import { generateActionId, type RepairAction, type RepairCandidate } from "./candidate.js"

export class RepairService {
  constructor(
    private memoryDir: string,
    private auditLog: AuditLog,
  ) {}

  async archive(filename: string, reason: string, candidateId?: string): Promise<void> {
    const filepath = join(this.memoryDir, filename)
    try {
      if (!existsSync(filepath)) {
        throw new Error(`File not found: ${filename}`)
      }
      const content = await readFile(filepath, "utf-8")
      const updated = this.setFrontmatterField(content, {
        status: "archived",
        archivedAt: Date.now(),
      })
      await writeFile(filepath, updated, "utf-8")

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
      const content = await readFile(filepath, "utf-8")
      const updated = this.setFrontmatterField(content, {
        status: "active",
        archivedAt: null,
      })
      await writeFile(filepath, updated, "utf-8")

      const action: RepairAction = {
        id: generateActionId(),
        type: "restore",
        filename,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason,
        result: "success",
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
