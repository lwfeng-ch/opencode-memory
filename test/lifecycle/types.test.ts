/**
 * opencode-memory — Lifecycle Metadata Tests (v0.3.3)
 */

import { describe, test, expect } from "vitest"
import {
  type MemoryStatus,
  type LifecycleMetadata,
  DEFAULT_LIFECYCLE,
  parseLifecycle,
  lifecycleScoreMultiplier,
} from "../../src/lifecycle/types.js"

describe("Lifecycle types", () => {
  test("MemoryStatus is 'active' or 'archived'", () => {
    const active: MemoryStatus = "active"
    const archived: MemoryStatus = "archived"
    expect(active).toBe("active")
    expect(archived).toBe("archived")
  })

  test("DEFAULT_LIFECYCLE has correct defaults", () => {
    expect(DEFAULT_LIFECYCLE.status).toBe("active")
    expect(DEFAULT_LIFECYCLE.createdAt).toBe(0)
    expect(DEFAULT_LIFECYCLE.lastRecalledAt).toBeNull()
    expect(DEFAULT_LIFECYCLE.archivedAt).toBeNull()
  })

  test("parseLifecycle reads active status from frontmatter", () => {
    const fm = { status: "active", createdAt: "1000", lastRecalledAt: "2000", archivedAt: "null" }
    const lc = parseLifecycle(fm)
    expect(lc.status).toBe("active")
    expect(lc.createdAt).toBe(1000)
    expect(lc.lastRecalledAt).toBe(2000)
    expect(lc.archivedAt).toBeNull()
  })

  test("parseLifecycle reads archived status", () => {
    const fm = { status: "archived", createdAt: "1000", archivedAt: "5000" }
    const lc = parseLifecycle(fm)
    expect(lc.status).toBe("archived")
    expect(lc.archivedAt).toBe(5000)
  })

  test("parseLifecycle defaults missing fields to active/0/null", () => {
    const lc = parseLifecycle({})
    expect(lc.status).toBe("active")
    expect(lc.createdAt).toBe(0)
    expect(lc.lastRecalledAt).toBeNull()
    expect(lc.archivedAt).toBeNull()
  })

  test("parseLifecycle handles invalid numeric values", () => {
    const fm = { status: "active", createdAt: "invalid", lastRecalledAt: "also-invalid" }
    const lc = parseLifecycle(fm)
    expect(lc.createdAt).toBe(0)
    expect(lc.lastRecalledAt).toBeNull()
  })

  test("parseLifecycle treats unknown status as active", () => {
    const fm = { status: "deleted" }
    const lc = parseLifecycle(fm)
    expect(lc.status).toBe("active") // unknown → active
  })

  test("parseLifecycle handles 'null' string in lastRecalledAt", () => {
    const fm = { status: "active", lastRecalledAt: "null" }
    const lc = parseLifecycle(fm)
    expect(lc.lastRecalledAt).toBeNull()
  })
})

describe("lifecycleScoreMultiplier", () => {
  test("active status → 1.0 (full score)", () => {
    expect(lifecycleScoreMultiplier("active")).toBe(1.0)
  })

  test("archived status → 0.1 (10x deprioritized)", () => {
    expect(lifecycleScoreMultiplier("archived")).toBe(0.1)
  })

  test("undefined status → 1.0 (default active)", () => {
    expect(lifecycleScoreMultiplier(undefined)).toBe(1.0)
  })

  test("archived gets 10x lower score than active", () => {
    const activeMultiplier = lifecycleScoreMultiplier("active")
    const archivedMultiplier = lifecycleScoreMultiplier("archived")
    expect(archivedMultiplier).toBeCloseTo(activeMultiplier * 0.1, 10)
  })

  test("archived still > 0 (searchable as last resort)", () => {
    expect(lifecycleScoreMultiplier("archived")).toBeGreaterThan(0)
  })
})
