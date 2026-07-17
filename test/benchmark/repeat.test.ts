import { describe, test, expect } from "vitest"
import {
  RepeatController,
  DEFAULT_REPEAT_POLICIES,
  type RepeatPolicy,
} from "../../benchmark/repeat.js"

describe("DEFAULT_REPEAT_POLICIES", () => {
  test("has 5 entries", () => {
    expect(DEFAULT_REPEAT_POLICIES.length).toBe(5)
  })

  test("extraction_pipeline has 3 runs", () => {
    const p = DEFAULT_REPEAT_POLICIES.find(
      (x) => x.suite === "extraction_pipeline",
    )
    expect(p?.runs).toBe(3)
  })

  test("recall has 1 run (deterministic)", () => {
    const p = DEFAULT_REPEAT_POLICIES.find((x) => x.suite === "recall")
    expect(p?.runs).toBe(1)
  })

  test("dedup has 3 runs", () => {
    const p = DEFAULT_REPEAT_POLICIES.find((x) => x.suite === "dedup")
    expect(p?.runs).toBe(3)
  })

  test("conflict has 3 runs", () => {
    const p = DEFAULT_REPEAT_POLICIES.find((x) => x.suite === "conflict")
    expect(p?.runs).toBe(3)
  })

  test("forgetting has 1 run (deterministic)", () => {
    const p = DEFAULT_REPEAT_POLICIES.find((x) => x.suite === "forgetting")
    expect(p?.runs).toBe(1)
  })

  test("all entries have a reason", () => {
    for (const p of DEFAULT_REPEAT_POLICIES) {
      expect(p.reason).toBeTruthy()
      expect(typeof p.reason).toBe("string")
    }
  })
})

describe("RepeatController", () => {
  test("getRepeatCount for each known suite", () => {
    const ctrl = new RepeatController()
    expect(ctrl.getRepeatCount("extraction_pipeline")).toBe(3)
    expect(ctrl.getRepeatCount("recall")).toBe(1)
    expect(ctrl.getRepeatCount("dedup")).toBe(3)
    expect(ctrl.getRepeatCount("conflict")).toBe(3)
    expect(ctrl.getRepeatCount("forgetting")).toBe(1)
  })

  test("unknown suite defaults to 1", () => {
    const ctrl = new RepeatController()
    expect(ctrl.getRepeatCount("unknown_suite")).toBe(1)
  })

  test("getPolicy returns policy for known suite", () => {
    const ctrl = new RepeatController()
    const policy = ctrl.getPolicy("dedup")
    expect(policy).toBeDefined()
    expect(policy?.suite).toBe("dedup")
    expect(policy?.runs).toBe(3)
  })

  test("getPolicy returns undefined for unknown suite", () => {
    const ctrl = new RepeatController()
    expect(ctrl.getPolicy("nonexistent")).toBeUndefined()
  })

  test("custom policies override defaults", () => {
    const customPolicies: RepeatPolicy[] = [
      { suite: "custom_suite", runs: 5, reason: "Testing custom override" },
    ]
    const ctrl = new RepeatController(customPolicies)
    expect(ctrl.getRepeatCount("custom_suite")).toBe(5)
    // Default policies are NOT present
    expect(ctrl.getRepeatCount("extraction_pipeline")).toBe(1)
  })

  test("empty policies map defaults to 1", () => {
    const ctrl = new RepeatController([])
    expect(ctrl.getRepeatCount("anything")).toBe(1)
  })
})
