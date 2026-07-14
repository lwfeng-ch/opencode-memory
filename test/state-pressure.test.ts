import { describe, test, expect } from "vitest"
import { DEFAULT_STATE, mergeState } from "../src/state.js"

describe("state: memory_pressure field", () => {
  test("DEFAULT_STATE has memory_pressure", () => {
    expect(DEFAULT_STATE.memory_pressure).toBeDefined()
    expect(DEFAULT_STATE.memory_pressure.level).toBe("normal")
    expect(DEFAULT_STATE.memory_pressure.files).toBe(0)
    expect(DEFAULT_STATE.memory_pressure.index_size).toBe(0)
    expect(DEFAULT_STATE.memory_pressure.total_size).toBe(0)
    expect(DEFAULT_STATE.memory_pressure.last_check).toBe("")
  })

  test("mergeState fills missing memory_pressure from defaults", () => {
    const merged = mergeState({})
    expect(merged.memory_pressure.level).toBe("normal")
    expect(merged.memory_pressure.files).toBe(0)
  })

  test("mergeState preserves provided memory_pressure", () => {
    const merged = mergeState({
      memory_pressure: {
        level: "critical",
        files: 500,
        index_size: 25000,
        total_size: 5242880,
        last_check: "2026-07-14T00:00:00Z",
      },
    })
    expect(merged.memory_pressure.level).toBe("critical")
    expect(merged.memory_pressure.files).toBe(500)
    expect(merged.memory_pressure.last_check).toBe("2026-07-14T00:00:00Z")
  })
})
