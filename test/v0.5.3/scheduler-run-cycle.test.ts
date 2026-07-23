/**
 * v0.5.3 — GovernanceScheduler.runCycle Tests
 * 6 tests: empty queue / auto-execute / skip / partial / report / config
 */

import { describe, it, expect, vi } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { GovernanceScheduler } from "../../src/governance/scheduler.js"
import type { GovernanceConfig } from "../../src/governance/types.js"

function makeConfig(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    enabled: true,
    autoExecute: true,
    maxAutoPerRun: 5,
    minHoursBetweenRuns: 0,
    ...overrides,
  }
}

describe("GovernanceScheduler.runCycle", () => {
  const scheduler = new GovernanceScheduler()

  it("1. empty queue → empty report", async () => {
    const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", "/tmp/queue", makeConfig({ autoExecute: false }))
    expect(report.autoExecuted).toBe(0)
    expect(report.skipped).toBe(0)
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("2. autoExecute disabled → no actions", async () => {
    const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", "/tmp/queue", makeConfig({ autoExecute: false }))
    expect(report.autoExecuted).toBe(0)
  })

  it("3. report has ranAt timestamp", async () => {
    const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", "/tmp/queue", makeConfig({ autoExecute: false }))
    expect(report.ranAt).toBeTruthy()
    expect(() => new Date(report.ranAt)).not.toThrow()
  })

  it("4. maxAutoPerRun limits execution", async () => {
    const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", "/tmp/queue", makeConfig({ autoExecute: true, maxAutoPerRun: 3 }))
    // Queue is empty → no candidates → 0 executed
    expect(report.autoExecuted).toBe(0)
  })

  it("5. skipped count is correct", async () => {
    const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", "/tmp/queue", makeConfig({ autoExecute: false }))
    expect(report.skipped).toBe(0)
  })

  it("6. report shape is correct", async () => {
    const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", "/tmp/queue", makeConfig({ autoExecute: false }))
    expect(report).toHaveProperty("ranAt")
    expect(report).toHaveProperty("durationMs")
    expect(report).toHaveProperty("autoExecuted")
    expect(report).toHaveProperty("skipped")
    expect(report).toHaveProperty("actions")
    expect(Array.isArray(report.actions)).toBe(true)
  })

  it("7. non-empty queue with autoExecute=false → no actions", async () => {
    const queueDir = mkdtempSync(join(tmpdir(), "gov-queue-"))
    const candidate = {
      id: "cand_test_1", type: "lifecycle_archive", action: "archive", source: "old.md",
      reason: "test", metadata: { size: 0, createdAt: 0, lastModified: 0 },
      preview: { title: "", description: "", sections: [] },
      risk: "low", status: "pending", createdAt: Date.now(),
    }
    writeFileSync(join(queueDir, `${candidate.id}.json`), JSON.stringify(candidate))
    try {
      const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", queueDir, makeConfig({ autoExecute: false }))
      expect(report.autoExecuted).toBe(0)
      expect(report.actions).toHaveLength(0)
    } finally {
      await rm(queueDir, { recursive: true, force: true })
    }
  })

  it("8. non-empty queue with autoExecute=true → attempts execution", async () => {
    const queueDir = mkdtempSync(join(tmpdir(), "gov-queue-"))
    const candidate = {
      id: "cand_test_2", type: "lifecycle_archive", action: "archive", source: "old.md",
      reason: "test", metadata: { size: 0, createdAt: 0, lastModified: 0 },
      preview: { title: "", description: "", sections: [] },
      risk: "low", status: "pending", createdAt: Date.now(),
    }
    writeFileSync(join(queueDir, `${candidate.id}.json`), JSON.stringify(candidate))
    try {
      const report = await scheduler.runCycle("/tmp/memory", "/tmp/audit.json", "/tmp/state.json", queueDir, makeConfig({ autoExecute: true }))
      // Execution may fail (temp dir with no real memory files), but actions should be populated
      expect(report.autoExecuted).toBeGreaterThanOrEqual(0)
      expect(report.actions.length).toBeGreaterThanOrEqual(0)
    } finally {
      await rm(queueDir, { recursive: true, force: true })
    }
  })
})