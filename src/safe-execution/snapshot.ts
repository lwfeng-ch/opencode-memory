/**
 * opencode-memory — SnapshotManager (v0.5.2)
 *
 * Creates and restores file snapshots for safe execution.
 * Snapshots are stored in .memory-backup/safe-execution/.
 *
 * Each snapshot is a full copy of the file before mutation.
 * Snapshots older than `cleanupDays` are automatically cleaned up.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises"
import { join } from "node:path"
import { generateSnapshotId, type TransactionSnapshot } from "./types.js"

export class SnapshotManager {
  private backupDir: string

  constructor(memoryDir: string) {
    this.backupDir = join(memoryDir, ".memory-backup", "safe-execution")
  }

  /**
   * Create a snapshot of a file before mutation.
   * Returns the snapshot metadata.
   */
  async create(filename: string, content: string): Promise<TransactionSnapshot> {
    const id = generateSnapshotId()
    const backupPath = `${id}_${filename.replace(/[^a-zA-Z0-9_.-]/g, "_")}`
    const fullPath = join(this.backupDir, backupPath)

    await mkdir(this.backupDir, { recursive: true })
    await writeFile(fullPath, content, "utf-8")

    const checksum = createHash("sha256").update(content).digest("hex")

    return {
      id,
      timestamp: Date.now(),
      operation: "archive",
      filename,
      backupPath,
      originalContent: content,
      checksum,
    }
  }

  /**
   * Restore a file from a snapshot.
   * Throws if the backup file no longer exists.
   */
  async restore(snapshot: TransactionSnapshot): Promise<void> {
    const fullPath = join(this.backupDir, snapshot.backupPath)
    const content = await readFile(fullPath, "utf-8")
    // Verify checksum
    const checksum = createHash("sha256").update(content).digest("hex")
    if (checksum !== snapshot.checksum) {
      throw new Error(`Snapshot ${snapshot.id}: checksum mismatch (expected ${snapshot.checksum}, got ${checksum})`)
    }
    // Write content back to original location — caller handles the actual file path
    // This just returns the content; the caller writes it
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
   * Delete old snapshots.
   * Returns the number of deleted snapshots.
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
          // Use a simple age check based on the snapshot timestamp in the filename
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
   * List all snapshots.
   */
  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.backupDir)
      return files.filter((f) => f.startsWith("snap_"))
    } catch {
      return []
    }
  }
}