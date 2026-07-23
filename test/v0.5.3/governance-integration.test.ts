/**
 * v0.5.3 — Governance Integration Tests
 * 4 tests: module exports / types / skeleton / wiring
 */

import { describe, it, expect } from "vitest"
import { GovernanceScheduler } from "../../src/governance/scheduler.js"

describe("Governance Integration", () => {
  it("1. GovernanceScheduler is constructable", () => {
    const scheduler = new GovernanceScheduler()
    expect(scheduler).toBeInstanceOf(GovernanceScheduler)
  })

  it("2. shouldRun is a function", () => {
    const scheduler = new GovernanceScheduler()
    expect(typeof scheduler.shouldRun).toBe("function")
  })

  it("3. runCycle is a function", () => {
    const scheduler = new GovernanceScheduler()
    expect(typeof scheduler.runCycle).toBe("function")
  })

  it("4. governance config type is correct", async () => {
    const { DEFAULT_CONFIG } = await import("../../src/config.js")
    expect(DEFAULT_CONFIG.governance).toBeDefined()
    expect(typeof DEFAULT_CONFIG.governance.enabled).toBe("boolean")
    expect(typeof DEFAULT_CONFIG.governance.maxAutoPerRun).toBe("number")
  })
})