/**
 * opencode-memory — Explicit Feedback Negative Tests (v0.3.3)
 *
 * Tests that non-directive messages are NOT detected as explicit feedback.
 * v0.3.3 three-condition check: signal + action intent + user authority.
 */

import { describe, test, expect } from "vitest"
import { detectExplicitFeedback } from "../src/explicit-feedback.js"

describe("explicit-feedback positive cases (should detect)", () => {
  test("记住 + action verb (使用)", () => {
    const result = detectExplicitFeedback("记住以后所有 Python 项目使用 uv")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
    expect(result!.content).toContain("使用")
  })

  test("always use (action built in)", () => {
    const result = detectExplicitFeedback("Always use pytest for testing")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })

  test("never use (action built in)", () => {
    const result = detectExplicitFeedback("Never use unittest in this project")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })

  test("以后不要 (action built in)", () => {
    const result = detectExplicitFeedback("以后不要使用 npm")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })

  test("from now on + action verb (use)", () => {
    const result = detectExplicitFeedback("From now on, use bun instead of npm")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })

  test("永远不要 (action built in)", () => {
    const result = detectExplicitFeedback("永远不要在生产环境使用 console.log")
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe("explicit")
  })
})

describe("explicit-feedback negative cases (should NOT detect)", () => {
  test("descriptive: 用户反馈", () => {
    expect(detectExplicitFeedback("用户反馈 npm 安装失败")).toBeNull()
  })

  test("descriptive: the user mentioned", () => {
    expect(detectExplicitFeedback("the user mentioned they like Go")).toBeNull()
  })

  test("descriptive: 用户说记住", () => {
    expect(detectExplicitFeedback("用户说记住密码很重要")).toBeNull()
  })

  test("no directive signal — just mentioning feedback", () => {
    expect(detectExplicitFeedback("I received feedback from the team about the API")).toBeNull()
  })

  test("signal but no action intent — 记住 without action verb", () => {
    // "记住密码" has signal "记住" but no action verb in the rest
    expect(detectExplicitFeedback("记住密码很重要")).toBeNull()
  })

  test("descriptive observation — the user always uses", () => {
    // "the user always uses Python" is descriptive, not directive
    expect(detectExplicitFeedback("the user always uses Python for data science")).toBeNull()
  })

  test("empty string", () => {
    expect(detectExplicitFeedback("")).toBeNull()
  })

  test("no signal at all", () => {
    expect(detectExplicitFeedback("Let's work on the API today")).toBeNull()
    expect(detectExplicitFeedback("I'm using Vue for this project")).toBeNull()
  })

  test("descriptive: 用户喜欢", () => {
    expect(detectExplicitFeedback("用户喜欢 TypeScript")).toBeNull()
  })

  test("descriptive: the user prefers", () => {
    expect(detectExplicitFeedback("the user prefers dark mode")).toBeNull()
  })

  test("signal in question form (not directive)", () => {
    // Question about remembering, not a directive to save
    expect(detectExplicitFeedback("Did you remember to commit the changes?")).toBeNull()
  })
})
