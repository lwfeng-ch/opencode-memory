/**
 * v0.5.2 — SnapshotManager Tests
 * 6 tests: create/restore/cleanup/list/missing/getTransaction
 */

import { describe, it, expect } from "vitest"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { SnapshotManager } from "../../src/safe-execution/snapshot.js"

describe("SnapshotManager", () => {
  async function withTempDir(fn: (dir: string, mgr: SnapshotManager) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), "snapshot-test-"))
    try {
      await fn(dir, new SnapshotManager(dir))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it("1. create snapshot returns TransactionContext", async () => {
    await withTempDir(async (dir, mgr) => {
      const tx = await mgr.create("test.md", "hello world")
      expect(tx.snapshot.filename).toBe("test.md")
      expect(tx.snapshot.originalContent).toBe("hello world")
      expect(tx.snapshot.checksum).toBeTruthy()
      expect(tx.snapshot.id).toMatch(/^snap_/)
      expect(tx.status).toBe("pending")
    })
  })

  it("2. readContent retrieves original content", async () => {
    await withTempDir(async (dir, mgr) => {
      const tx = await mgr.create("test.md", "hello world")
      const content = await mgr.readContent(tx.snapshot)
      expect(content).toBe("hello world")
    })
  })

  it("3. restoreToFile writes content to target path", async () => {
    await withTempDir(async (dir, mgr) => {
      const tx = await mgr.create("test.md", "original content")
      const targetPath = join(dir, "restored.md")
      await mgr.restoreToFile(tx.snapshot, targetPath)
      const content = readFileSync(targetPath, "utf-8")
      expect(content).toBe("original content")
    })
  })

  it("4. list returns snapshot files", async () => {
    await withTempDir(async (dir, mgr) => {
      await mgr.create("a.md", "content a")
      await mgr.create("b.md", "content b")
      const files = await mgr.list()
      expect(files.length).toBeGreaterThanOrEqual(2)
    })
  })

  it("5. cleanup on empty dir returns 0", async () => {
    await withTempDir(async (dir, mgr) => {
      const count = await mgr.cleanup(1)
      expect(count).toBe(0)
    })
  })

  it("6. getTransaction returns null for unknown ID", async () => {
    await withTempDir(async (dir, mgr) => {
      const tx = await mgr.getTransaction("nonexistent")
      expect(tx).toBeNull()
    })
  })
})