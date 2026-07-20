/**
 * opencode-memory — Candidate Queue (v0.3.3)
 *
 * File-based queue for repair candidates.
 * Scanners add candidates → CLI reads → user approves → service executes.
 */

import { join } from "node:path"
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises"
import type { RepairCandidate, CandidateStatus } from "./candidate.js"

export interface CandidateQueue {
  add(candidate: RepairCandidate): Promise<void>
  get(id: string): Promise<RepairCandidate | null>
  getAll(): Promise<RepairCandidate[]>
  getPending(): Promise<RepairCandidate[]>
  updateStatus(id: string, status: CandidateStatus): Promise<void>
  clearExecuted(): Promise<void>
}

export class FileCandidateQueue implements CandidateQueue {
  constructor(private queueDir: string) {}

  async add(candidate: RepairCandidate): Promise<void> {
    await mkdir(this.queueDir, { recursive: true })
    const path = join(this.queueDir, `${candidate.id}.json`)
    await writeFile(path, JSON.stringify(candidate, null, 2), "utf-8")
  }

  async get(id: string): Promise<RepairCandidate | null> {
    try {
      const content = await readFile(join(this.queueDir, `${id}.json`), "utf-8")
      return JSON.parse(content) as RepairCandidate
    } catch {
      return null
    }
  }

  async getAll(): Promise<RepairCandidate[]> {
    try {
      const files = await readdir(this.queueDir)
      const candidates: RepairCandidate[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const content = await readFile(join(this.queueDir, file), "utf-8")
        candidates.push(JSON.parse(content) as RepairCandidate)
      } catch {
        // skip malformed
      }
    }
    return candidates.sort((a, b) => a.createdAt - b.createdAt)
    } catch {
      return []
    }
  }

  async getPending(): Promise<RepairCandidate[]> {
    const all = await this.getAll()
    return all.filter((c) => c.status === "pending")
  }

  async updateStatus(id: string, status: CandidateStatus): Promise<void> {
    const candidate = await this.get(id)
    if (!candidate) throw new Error(`Candidate not found: ${id}`)
    candidate.status = status
    await this.add(candidate) // overwrite
  }

  async clearExecuted(): Promise<void> {
    const all = await this.getAll()
    for (const c of all) {
      if (c.status === "executed" || c.status === "rejected") {
        try {
          await unlink(join(this.queueDir, `${c.id}.json`))
        } catch {
          // ignore
        }
      }
    }
  }
}
