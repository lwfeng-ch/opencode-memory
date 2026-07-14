import { describe, test, expect } from "vitest"
import { getFactRootDir, getCursorDir, getCursorPath } from "../src/paths.js"
import { join } from "path"

describe("cursor path helpers", () => {
  test("getFactRootDir returns <memoryDir>/fact/ not fact/sessions/", () => {
    const result = getFactRootDir("/tmp/mem")
    expect(result).toBe(join("/tmp/mem", "fact"))
    expect(result).not.toContain("sessions")
  })

  test("getCursorDir returns <memoryDir>/fact/cursor/", () => {
    const result = getCursorDir("/tmp/mem")
    expect(result).toBe(join("/tmp/mem", "fact", "cursor"))
  })

  test("getCursorPath returns extraction-cursor.json path", () => {
    const result = getCursorPath("/tmp/mem")
    expect(result).toBe(join("/tmp/mem", "fact", "cursor", "extraction-cursor.json"))
  })
})
