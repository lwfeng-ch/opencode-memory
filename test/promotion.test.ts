import { describe, test, expect } from "vitest"
import { canOverride } from "../src/promotion.js"

describe("canOverride", () => {
  // --- Same level: never allows override (strict > required) ---

  test("explicit vs explicit → false (same level)", () => {
    expect(canOverride("explicit", "explicit")).toBe(false)
  })
  test("observed vs observed → false", () => {
    expect(canOverride("observed", "observed")).toBe(false)
  })
  test("inferred vs inferred → false", () => {
    expect(canOverride("inferred", "inferred")).toBe(false)
  })
  test("derived vs derived → false", () => {
    expect(canOverride("derived", "derived")).toBe(false)
  })
  test("uncertain vs uncertain → false", () => {
    expect(canOverride("uncertain", "uncertain")).toBe(false)
  })

  // --- Higher overrides lower ---

  test("explicit overrides observed → true", () => {
    expect(canOverride("observed", "explicit")).toBe(true)
  })
  test("explicit overrides inferred → true", () => {
    expect(canOverride("inferred", "explicit")).toBe(true)
  })
  test("explicit overrides derived → true", () => {
    expect(canOverride("derived", "explicit")).toBe(true)
  })
  test("explicit overrides uncertain → true", () => {
    expect(canOverride("uncertain", "explicit")).toBe(true)
  })
  test("observed overrides inferred → true", () => {
    expect(canOverride("inferred", "observed")).toBe(true)
  })
  test("observed overrides derived → true", () => {
    expect(canOverride("derived", "observed")).toBe(true)
  })
  test("observed overrides uncertain → true", () => {
    expect(canOverride("uncertain", "observed")).toBe(true)
  })
  test("inferred overrides derived → true", () => {
    expect(canOverride("derived", "inferred")).toBe(true)
  })
  test("inferred overrides uncertain → true", () => {
    expect(canOverride("uncertain", "inferred")).toBe(true)
  })
  test("derived overrides uncertain → true", () => {
    expect(canOverride("uncertain", "derived")).toBe(true)
  })

  // --- Lower cannot override higher ---

  test("observed cannot override explicit → false", () => {
    expect(canOverride("explicit", "observed")).toBe(false)
  })
  test("inferred cannot override explicit → false", () => {
    expect(canOverride("explicit", "inferred")).toBe(false)
  })
  test("derived cannot override explicit → false", () => {
    expect(canOverride("explicit", "derived")).toBe(false)
  })
  test("uncertain cannot override explicit → false", () => {
    expect(canOverride("explicit", "uncertain")).toBe(false)
  })
  test("derived cannot override inferred → false", () => {
    expect(canOverride("inferred", "derived")).toBe(false)
  })
  test("uncertain cannot override derived → false", () => {
    expect(canOverride("derived", "uncertain")).toBe(false)
  })
  test("uncertain cannot override inferred → false", () => {
    expect(canOverride("inferred", "uncertain")).toBe(false)
  })

  // --- Unknown / invalid values → priority 0 (same as uncertain) ---

  test("unknown confidence falls to priority 0", () => {
    expect(canOverride("unknown_value", "explicit")).toBe(true)
    expect(canOverride("explicit", "unknown_value")).toBe(false)
  })
  test("empty string falls to priority 0", () => {
    expect(canOverride("", "derived")).toBe(true)
    expect(canOverride("derived", "")).toBe(false)
  })
  test("two unknown values → both 0 → false (not strictly higher)", () => {
    expect(canOverride("unknown1", "unknown2")).toBe(false)
  })
})
