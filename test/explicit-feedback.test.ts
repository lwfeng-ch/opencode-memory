import { describe, test, expect } from "vitest"
import { detectExplicitFeedback } from "../src/explicit-feedback.js"

describe("detectExplicitFeedback", () => {
  test("detects '记住' pattern", () => {
    const result = detectExplicitFeedback("记住，我喜欢用Vue而不是React")
    expect(result).not.toBeNull()
    expect(result!.type).toBe("feedback")
    expect(result!.confidence).toBe("explicit")
    expect(result!.content).toContain("Vue")
  })

  test("detects '以后不要' pattern", () => {
    const result = detectExplicitFeedback("以后不要使用var声明变量了")
    expect(result).not.toBeNull()
    expect(result!.type).toBe("feedback")
    expect(result!.confidence).toBe("explicit")
  })

  test("detects 'always use' English pattern", () => {
    const result = detectExplicitFeedback("Always use TypeScript for new files")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })

  test("detects 'never use' English pattern", () => {
    const result = detectExplicitFeedback("Never use console.log in production")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })

  test("returns null for non-explicit content", () => {
    expect(detectExplicitFeedback("Let's work on the API today")).toBeNull()
    expect(detectExplicitFeedback("I'm using Vue for this project")).toBeNull()
    expect(detectExplicitFeedback("")).toBeNull()
  })
})
