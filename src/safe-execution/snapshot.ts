/**
 * opencode-memory — SnapshotManager (v0.5.2)
 *
 * Creates and restores file snapshots for safe execution.
 * Snapshots are stored in .memory-backup/safe-execution/.
 *
 * Each snapshot has two files:
 *   snap_xxx_yyy_<filename>       — the original file content
 *   snap_xxx_yyy_<filename>.tx.json — transaction metadata
 *
 * Snapshots older than `cleanupDays` are automatically cleaned up.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises"
import { join } from "node:path"
import {
  generateSnapshotId,
  type TransactionSnapshot,
  type TransactionContext,
  type RiskAssessment,
} from "./types.js"

export class SnapshotManager {
  private backupDir: string

  constructor(memoryDir: string) {
    this.backupDir = join(memoryDir, ".memory-backup", "safe-execution")
  }

  /**
   * Create a snapshot of a file before mutation.
   * Also writes a .tx.json metadata file for rollback support.
   */
  async create(
    filename: string,
    content: string,
    riskAssessment?: RiskAssessment,
    candidateId?: string,
  ): Promise<TransactionContext> {
    const id = generateSnapshotId()
    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "_")
    const backupPath = `${id}_${safeName}`
    const fullPath = join(this.backupDir, backupPath)

    await mkdir(this.backupDir, { recursive: true })
    await writeFile(fullPath, content, "utf-8")

    const checksum = createHash("sha256").update(content).digest("hex")

    const snapshot: TransactionSnapshot = {
      id,
      timestamp: Date.now(),
      operation: "archive",
      filename,
      backupPath,
      originalContent: content,
      checksum,
    }

    const tx: TransactionContext = {
      snapshot,
      riskAssessment: riskAssessment ?? {
        score: 0, impact: 0, confidence: 0, blastRadius: 0,
        reversibility: "easy", factEvidence: { hasDirectUserInput: false, totalSessions: 0 },
        autoExecutable: false, label: "low",
      },
      candidateId,
      status: "pending",
    }

    // Write .tx.json metadata
    const txPath = join(this.backupDir, `${backupPath}.tx.json`)
    await writeFile(txPath, JSON.stringify(tx, null, 2), "utf-8")

    return tx
  }

  /**
   * @deprecated Use restoreToFile() instead. This method only verifies checksum.
   */
  async restore(snapshot: TransactionSnapshot): Promise<void> {
    const fullPath = join(this.backupDir, snapshot.backupPath)
    const content = await readFile(fullPath, "utf-8")
    const checksum = createHash("sha256").update(content).digest("hex")
    if (checksum !== snapshot.checksum) {
      throw new Error(`Snapshot ${snapshot.id}: checksum mismatch (expected ${snapshot.checksum}, got ${checksum})`)
    }
    throw new Error("Use restoreToFile() to restore to a specific path")
  }

  /**
   * Restore snapshot content to a specific file path.
   */
  async restoreToFile(snapshot: TransactionSnapshot, targetPath: string): Promise<void> {
    const fullPath = join(this.backupDir, snapshot.backupPath)
    const content = await readFile(fullPath, "utf-8")
    const checksum = createHash("sha256").update(content).digest("hex")
    if (checksum !== snapshot.checksum) {
      throw new Error(`Snapshot ${snapshot.id}: checksum mismatch (expected ${snapshot.checksum}, got ${checksum})`)
    }
    await writeFile(targetPath, content, "utf-8")
  }

  /**
   * Get the original content from a snapshot.
   */
  async readContent(snapshot: TransactionSnapshot): Promise<string> {
    const fullPath = join(this.backupDir, snapshot.backupPath)
    return await readFile(fullPath, "utf-8")
  }

  /**
   * Read transaction context by snapshot ID.
   * Returns null if not found.
   */
  async getTransaction(snapshotId: string): Promise<TransactionContext | null> {
    try {
      const files = await readdir(this.backupDir)
      const txFile = files.find((f) => f.startsWith(snapshotId) && f.endsWith(".tx.json"))
      if (!txFile) return null
      const content = await readFile(join(this.backupDir, txFile), "utf-8")
      return JSON.parse(content) as TransactionContext
    } catch {
      return null
    }
  }

  /**
   * List all transactions with their metadata.
   */
  async listTransactions(): Promise<TransactionContext[]> {
    try {
      const files = await readdir(this.backupDir)
      const txFiles = files.filter((f) => f.endsWith(".tx.json"))
      const txs: TransactionContext[] = []
      for (const f of txFiles) {
        try {
          const content = await readFile(join(this.backupDir, f), "utf-8")
          txs.push(JSON.parse(content) as TransactionContext)
        } catch {
          // skip malformed
        }
      }
      return txs.sort((a, b) => (a.snapshot.timestamp || 0) - (b.snapshot.timestamp || 0))
    } catch {
      return []
    }
  }

  /**
   * Delete old snapshots.
   * Returns the number of deleted snapshot files.
   */
  async cleanup(olderThanDays: number): Promise<number> {
    try {
      const files = await readdir(this.backupDir)
      const now = Date.now()
      const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000
      let deleted = 0

      for (const file of files) {
        try {
          const fullPath = join(this.backupDir, file)
          if (file.startsWith("snap_")) {
            const snapTime = parseInt(file.split("_")[1], 36)
            if (!isNaN(snapTime) && snapTime < cutoff) {
              await unlink(fullPath)
              deleted++
            }
          }
        } catch {
          // skip unreadable
        }
      }
      return deleted
    } catch {
      return 0
    }
  }

  /**
   * List all snapshot files.
   */
  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.backupDir)
      return files.filter((f) => f.startsWith("snap_") && !f.endsWith(".tx.json"))
    } catch {
      return []
    }
  }
}