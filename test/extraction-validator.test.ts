import { describe, test, expect } from "bun:test"
import { validateExtractionOutput } from "../src/extraction-validator.js"

describe("validateExtractionOutput", () => {
  test("rejects empty content", () => {
    const result = validateExtractionOutput("")
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Content is empty")
  })

  test("rejects whitespace-only content", () => {
    const result = validateExtractionOutput("   \n\n  \n  ")
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Content is empty")
  })

  test("rejects content with no markdown headers", () => {
    const result = validateExtractionOutput("This is just plain text with no structure.")
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("No markdown section headers"))).toBe(true)
  })

  test("accepts content with at least one section header", () => {
    const result = validateExtractionOutput("# Current State\nWorking on memory system.")
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test("rejects content that is only placeholder text", () => {
    const result = validateExtractionOutput("# Current State\n_What is being worked on right now?_")
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("placeholder"))).toBe(true)
  })

  test("rejects multiple placeholder-only sections", () => {
    const content = [
      "# Session Title",
      "_A short 5-10 word title_",
      "",
      "# Current State",
      "_What is being worked on right now?_",
      "",
    ].join("\n")
    const result = validateExtractionOutput(content)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("2 sections contain only placeholder"))).toBe(true)
  })

  test("accepts mixed content with some real sections", () => {
    const content = [
      "# Session Title",
      "_A short 5-10 word title_",
      "",
      "# Current State",
      "Implemented extraction validator module.",
      "All tests passing.",
    ].join("\n")
    const result = validateExtractionOutput(content)
    expect(result.valid).toBe(true)
  })

  test("rejects content exceeding max size", () => {
    const hugeContent = "# Section\n" + "x".repeat(15_000)
    const result = validateExtractionOutput(hugeContent, { maxContentBytes: 10_000 })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("exceeds maximum"))).toBe(true)
  })

  test("accepts content within default size limits", () => {
    const content = "# State\n" + "x".repeat(5000)
    const result = validateExtractionOutput(content)
    expect(result.valid).toBe(true)
  })

  test("rejects content that is just a single filler sentence", () => {
    const result = validateExtractionOutput("MEMORY.md 索引条目无需更新。")
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("No markdown section headers"))).toBe(true)
  })
})
