/**
 * v0.5.3 — Governance State Tests
 * 4 tests: default / merge / update / roundtrip
 */

import { describe, it, expect } from "vitest"
import { DEFAULT_STATE, mergeState } from "../../src/state.js"

describe("Governance State", () => {
  it("1. default governance state", () => {
    expect(DEFAULT_STATE.governance).toBeDefined()
    expect(DEFAULT_STATE.governance.last_run_at).toBeNull()
    expect(DEFAULT_STATE.governance.total_actions).toBe(0)
  })

  it("2. mergeState preserves governance defaults", () => {
    const state = mergeState({})
    expect(state.governance.last_run_at).toBeNull()
    expect(state.governance.total_actions).toBe(0)
  })

  it("3. mergeState merges governance fields", () => {
    const state = mergeState({
      governance: { last_run_at: "2026-07-23T12:00:00Z", total_actions: 5, total_success: 4, total_failed: 1 },
    })
    expect(state.governance.last_run_at).toBe("2026-07-23T12:00:00Z")
    expect(state.governance.total_actions).toBe(5)
    expect(state.governance.total_success).toBe(4)
    expect(state.governance.total_failed).toBe(1)
  })

  it("4. governance type is correct", () => {
    const state = DEFAULT_STATE
    expect(typeof state.governance.total_actions).toBe("number")
    expect(typeof state.governance.total_success).toBe("number")
    expect(typeof state.governance.total_failed).toBe("number")
    expect(state.governance.last_run_at === null || typeof state.governance.last_run_at === "string").toBe(true)
  })
})