/**
 * opencode-memory — Candidate Queue Tests (v0.3.3)
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { FileCandidateQueue } from "../../src/repair/queue.js"
import { generateCandidateId, type RepairCandidate } from "../../src/repair/candidate.js"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"

function makeCandidate(overrides?: Partial<RepairCandidate>): RepairCandidate {
  return {
    id: generateCandidateId(),
    type: "legacy_v1",
    action: "delete",
    source: "test.md",
    reason: "test reason",
    metadata: { size: 1024, createdAt: Date.now(), lastModified: Date.now() },
    preview: { title: "Test", description: "Test desc", sections: ["S1"] },
    risk: "low",
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("FileCandidateQueue", () => {
  const testDir = join(tmpdir(), `repair-queue-test-${randomBytes(4).toString("hex")}`)
  let queue: FileCandidateQueue

  beforeEach(() => {
    try { mkdirSync(testDir, { recursive: true }) } catch {}
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    try { mkdirSync(testDir, { recursive: true }) } catch {}
    queue = new FileCandidateQueue(testDir)
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("add writes candidate file and get reads it", async () => {
    const candidate = makeCandidate({ id: "cand_test_001" })
    await queue.add(candidate)
    const read = await queue.get("cand_test_001")
    expect(read).not.toBeNull()
    expect(read!.id).toBe("cand_test_001")
    expect(read!.source).toBe("test.md")
  })

  test("get returns null for non-existent id", async () => {
    const result = await queue.get("nonexistent")
    expect(result).toBeNull()
  })

  test("getAll returns all candidates sorted by createdAt", async () => {
    const c1 = makeCandidate({ id: "c1", createdAt: 2000 })
    const c2 = makeCandidate({ id: "c2", createdAt: 1000 })
    const c3 = makeCandidate({ id: "c3", createdAt: 3000 })
    await queue.add(c1)
    await queue.add(c2)
    await queue.add(c3)
    const all = await queue.getAll()
    expect(all).toHaveLength(3)
    expect(all[0].id).toBe("c2") // createdAt=1000 first
    expect(all[2].id).toBe("c3") // createdAt=3000 last
  })

  test("getAll returns empty when queue dir doesn't exist", async () => {
    const emptyQueue = new FileCandidateQueue(join(testDir, "nonexistent"))
    const all = await emptyQueue.getAll()
    expect(all).toEqual([])
  })

  test("getPending returns only status=pending", async () => {
    const c1 = makeCandidate({ id: "c1", status: "pending" })
    const c2 = makeCandidate({ id: "c2", status: "approved" })
    const c3 = makeCandidate({ id: "c3", status: "pending" })
    await queue.add(c1)
    await queue.add(c2)
    await queue.add(c3)
    const pending = await queue.getPending()
    expect(pending).toHaveLength(2)
    expect(pending.every(c => c.status === "pending")).toBe(true)
  })

  test("updateStatus changes candidate status", async () => {
    const candidate = makeCandidate({ id: "c1", status: "pending" })
    await queue.add(candidate)
    await queue.updateStatus("c1", "approved")
    const updated = await queue.get("c1")
    expect(updated!.status).toBe("approved")
  })

  test("updateStatus throws for non-existent candidate", async () => {
    await expect(queue.updateStatus("nonexistent", "approved")).rejects.toThrow()
  })

  test("clearExecuted removes executed and rejected candidates", async () => {
    const c1 = makeCandidate({ id: "c1", status: "executed" })
    const c2 = makeCandidate({ id: "c2", status: "rejected" })
    const c3 = makeCandidate({ id: "c3", status: "pending" })
    await queue.add(c1)
    await queue.add(c2)
    await queue.add(c3)
    await queue.clearExecuted()
    const all = await queue.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe("c3") // only pending remains
  })

  test("add overwrites existing candidate with same id", async () => {
    const c1 = makeCandidate({ id: "c1", reason: "original" })
    await queue.add(c1)
    const c1Updated = makeCandidate({ id: "c1", reason: "updated" })
    await queue.add(c1Updated)
    const read = await queue.get("c1")
    expect(read!.reason).toBe("updated")
  })

  test("candidate preserves preview and metadata", async () => {
    const candidate = makeCandidate({
      preview: { title: "Memory Title", description: "A description", sections: ["S1", "S2"] },
      metadata: { size: 4096, createdAt: 123, lastModified: 456 },
    })
    await queue.add(candidate)
    const read = await queue.get(candidate.id)
    expect(read!.preview.title).toBe("Memory Title")
    expect(read!.preview.sections).toEqual(["S1", "S2"])
    expect(read!.metadata.size).toBe(4096)
  })
})
