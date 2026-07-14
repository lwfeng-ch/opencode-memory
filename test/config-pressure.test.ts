import { describe, test, expect } from "vitest"
import { resolveConfig } from "../src/config.js"

describe("config: memoryPressure defaults", () => {
  test("has all 5 fields with correct defaults", () => {
    const config = resolveConfig()
    expect(config.memoryPressure).toBeDefined()
    expect(config.memoryPressure.maxFiles).toBe(500)
    expect(config.memoryPressure.maxIndexSize).toBe(25_000)
    expect(config.memoryPressure.maxTotalSize).toBe(5_242_880)
    expect(config.memoryPressure.elevatedRatio).toBe(0.7)
    expect(config.memoryPressure.criticalRatio).toBe(0.9)
  })
})

describe("config: telemetry defaults", () => {
  test("has all 3 fields with correct defaults", () => {
    const config = resolveConfig()
    expect(config.telemetry).toBeDefined()
    expect(config.telemetry.enabled).toBe(true)
    expect(config.telemetry.retentionDays).toBe(30)
    expect(config.telemetry.maxFileBytes).toBe(10_485_760)
  })
})

describe("config: agents defaults", () => {
  test("has 3 stages with correct category defaults", () => {
    const config = resolveConfig()
    expect(config.agents).toBeDefined()
    expect(config.agents.extraction.category).toBe("quick")
    expect(config.agents.dream.category).toBe("deep")
    expect(config.agents.recall.agent).toBe("explore")
  })
})

describe("config: deep copy isolation", () => {
  test("modifying one config doesn't pollute DEFAULT_CONFIG", () => {
    const c1 = resolveConfig()
    c1.memoryPressure.maxFiles = 999
    c1.telemetry.enabled = false
    c1.agents.extraction.category = "deep"

    const c2 = resolveConfig()
    expect(c2.memoryPressure.maxFiles).toBe(500)
    expect(c2.telemetry.enabled).toBe(true)
    expect(c2.agents.extraction.category).toBe("quick")
  })
})
