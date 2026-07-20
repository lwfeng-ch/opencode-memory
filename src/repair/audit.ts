/**
 * opencode-memory — Audit Log (v0.3.3)
 *
 * JSONL audit log for all repair actions (archive/delete/restore).
 * Every action is recorded with timestamp, filename, reason, result.
 */

import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import type { RepairAction } from "./candidate.js"

export class AuditLog {
  constructor(private logFile: string) {}

  async log(action: RepairAction): Promise<void> {
    await mkdir(dirname(this.logFile), { recursive: true })
    const { appendFile } = await import("node:fs/promises")
    await appendFile(this.logFile, JSON.stringify(action) + "\n", "utf-8")
  }

  async getAll(): Promise<RepairAction[]> {
    const { readFile } = await import("node:fs/promises")
    try {
      const content = await readFile(this.logFile, "utf-8")
      return content
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as RepairAction)
    } catch {
      return []
    }
  }

  async query(filter: { type?: RepairAction["type"]; filename?: string }): Promise<RepairAction[]> {
    const all = await this.getAll()
    return all.filter((a) => {
      if (filter.type && a.type !== filter.type) return false
      if (filter.filename && a.filename !== filter.filename) return false
      return true
    })
  }
}
