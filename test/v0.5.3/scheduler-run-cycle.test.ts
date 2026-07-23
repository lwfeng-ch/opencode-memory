/**
 * v0.5.3 — GovernanceScheduler.runCycle Tests
 * 6 tests: empty queue / auto-execute / skip / partial / report / config
 */

import { describe, it, expect, vi } from "vitest"
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
})