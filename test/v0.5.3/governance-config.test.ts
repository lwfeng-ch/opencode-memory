/**
 * v0.5.3 — GovernanceConfig Tests
 * 5 tests: defaults / enabled / disabled / config parsing / fields
 */

import { describe, it, expect } from "vitest"
import { DEFAULT_CONFIG, resolveConfig } from "../../src/config.js"

describe("GovernanceConfig", () => {
  it("1. defaults are opt-in disabled", () => {
    expect(DEFAULT_CONFIG.governance.enabled).toBe(false)
    expect(DEFAULT_CONFIG.governance.autoExecute).toBe(false)
  })

  it("2. maxAutoPerRun defaults to 5", () => {
    expect(DEFAULT_CONFIG.governance.maxAutoPerRun).toBe(5)
  })

  it("3. minHoursBetweenRuns defaults to 24", () => {
    expect(DEFAULT_CONFIG.governance.minHoursBetweenRuns).toBe(24)
  })

  it("4. resolveConfig preserves governance defaults", () => {
    const config = resolveConfig()
    expect(config.governance.enabled).toBe(false)
    expect(config.governance.autoExecute).toBe(false)
  })

  it("5. resolveConfig overrides governance", () => {
    const config = resolveConfig({
      governance: { enabled: true, autoExecute: true, maxAutoPerRun: 10, minHoursBetweenRuns: 12 },
    })
    expect(config.governance.enabled).toBe(true)
    expect(config.governance.autoExecute).toBe(true)
    expect(config.governance.maxAutoPerRun).toBe(10)
    expect(config.governance.minHoursBetweenRuns).toBe(12)
  })
})