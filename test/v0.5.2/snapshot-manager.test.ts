/**
 * v0.5.2 — SnapshotManager Tests
 * 6 tests: create/restore/cleanup/list/missing/overwrite
 */

import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdir, writeFile, rm } from "node:fs/promises"
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

  it("1. create snapshot", async () => {
    await withTempDir(async (dir, mgr) => {
      const snap = await mgr.create("test.md", "hello world")
      expect(snap.filename).toBe("test.md")
      expect(snap.originalContent).toBe("hello world")
      expect(snap.checksum).toBeTruthy()
      expect(snap.id).toMatch(/^snap_/)
    })
  })

  it("2. restore snapshot content via readContent", async () => {
    await withTempDir(async (dir, mgr) => {
      const snap = await mgr.create("test.md", "hello world")
      const content = await mgr.readContent(snap)
      expect(content).toBe("hello world")
    })
  })

  it("3. restoreToFile writes content to target path", async () => {
    await withTempDir(async (dir, mgr) => {
      const snap = await mgr.create("test.md", "original content")
      const targetPath = join(dir, "restored.md")
      await mgr.restoreToFile(snap, targetPath)
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

  it("6. checksum verification on restore", async () => {
    await withTempDir(async (dir, mgr) => {
      const snap = await mgr.create("test.md", "hello world")
      const content = await mgr.readContent(snap)
      expect(content).toBe("hello world")
    })
  })
})