import { describe, test, expect } from "vitest"
import { parsePrepareResponse } from "../src/dream.js"

describe("parsePrepareResponse", () => {
  test("parses orient + gather from combined JSON", () => {
    const response = JSON.stringify({
      orient: { drift_candidates: ["file1.md", "file2.md"] },
      gather: { facts: [{ filename: "file1.md", issue: "outdated" }] },
    })
    const result = parsePrepareResponse(response)
    expect(result.orient).toBeDefined()
    expect(result.gather).toBeDefined()
    expect((result.orient as Record<string, unknown>).drift_candidates).toHaveLength(2)
    expect((result.gather as Record<string, unknown>).facts).toHaveLength(1)
  })

  test("handles missing orient section", () => {
    const response = JSON.stringify({ gather: { facts: [] } })
    const result = parsePrepareResponse(response)
    expect(result.orient).toEqual({})
    expect(result.gather).toBeDefined()
  })

  test("handles missing gather section", () => {
    const response = JSON.stringify({ orient: { drift_candidates: [] } })
    const result = parsePrepareResponse(response)
    expect(result.orient).toBeDefined()
    expect(result.gather).toEqual({})
  })

  test("handles malformed JSON gracefully", () => {
    const result = parsePrepareResponse("not json at all")
    expect(result.orient).toEqual({})
    expect(result.gather).toEqual({})
  })

  test("handles JSON wrapped in code fences", () => {
    const response = "```json\n" + JSON.stringify({
      orient: { drift_candidates: ["a.md"] },
      gather: { facts: [] },
    }) + "\n```"
    const result = parsePrepareResponse(response)
    expect(result.orient).toBeDefined()
    expect((result.orient as Record<string, unknown>).drift_candidates).toHaveLength(1)
  })
})
