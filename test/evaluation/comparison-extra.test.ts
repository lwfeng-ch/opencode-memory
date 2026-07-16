/**
 * opencode-memory — Additional Comparison Edge Case Tests (v0.3.1)
 */

import { describe, test, expect } from "vitest"
import { DefaultMemoryComparator, type ComparableMemory } from "../../src/evaluation/comparison.js"

describe("Comparison edge cases", () => {
  const comparator = new DefaultMemoryComparator()

  test("compareText with numbers — version strings", () => {
    const score = comparator.compareText("Python 3.10", "Python 3.10")
    expect(score).toBe(1.0)
  })

  test("compareText with very long strings — still works", () => {
    const longA = "The user is a senior engineer. ".repeat(50)
    const longB = "The user is a senior engineer. ".repeat(50)
    const score = comparator.compareText(longA, longB)
    expect(score).toBe(1.0)
  })

  test("compareMemory with only content field — other fields default", () => {
    const expected: ComparableMemory = { content: "just content here" }
    const actual: ComparableMemory = { content: "just content here" }
    const result = comparator.compareMemory(expected, actual)
    // content matches 1.0 * 0.5 = 0.5, others are undefined===undefined = 1.0
    // score = 1.0*0.5 + 1.0*0.2 + 1.0*0.2 + 1.0*0.1 = 1.0
    expect(result.score).toBe(1.0)
    expect(result.passed).toBe(true)
  })

  test("compareMemory — identical content but different types affects score", () => {
    const expected: ComparableMemory = { content: "same content", type: "user" }
    const actual: ComparableMemory = { content: "same content", type: "project" }
    const result = comparator.compareMemory(expected, actual)
    expect(result.fields.content).toBe(1.0)
    expect(result.fields.type).toBe(0)
    // score = 1.0*0.5 + 1.0*0.2 + 0*0.2 + 1.0*0.1 = 0.8
    expect(result.score).toBe(0.8)
  })

  test("compareText with special characters (brackets, quotes)", () => {
    const score = comparator.compareText(
      'User prefers [Go] for "backend"',
      'User prefers [Go] for "backend"',
    )
    expect(score).toBe(1.0)
  })
})
