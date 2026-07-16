/**
 * opencode-memory — Golden Dataset Loading Tests (v0.3.1)
 *
 * Tests that golden cases load correctly from benchmark/data/.
 */

import { describe, test, expect } from "vitest"
import { loadDataset, filterBySuite } from "../../benchmark/dataset.js"
import { join } from "node:path"

const dataDir = join(process.cwd(), "benchmark", "data")

describe("Golden dataset loading", () => {
  test("loadDataset loads all golden cases", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenCases = allCases.filter((c) => c.id.startsWith("golden-"))
    expect(goldenCases.length).toBe(50)
  })

  test("golden cases have version 0.3.1", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenCases = allCases.filter((c) => c.id.startsWith("golden-"))
    for (const c of goldenCases) {
      expect(c.version).toBe("0.3.1")
    }
  })

  test("golden extraction_pipeline cases load correctly", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenExtraction = allCases.filter(
      (c) => c.id.startsWith("golden-") && c.suite === "extraction_pipeline",
    )
    expect(goldenExtraction.length).toBe(15)
  })

  test("golden recall cases load correctly", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenRecall = allCases.filter(
      (c) => c.id.startsWith("golden-") && c.suite === "recall",
    )
    expect(goldenRecall.length).toBe(15)
  })

  test("golden dedup + conflict + forgetting cases total 20", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenOther = allCases.filter(
      (c) => c.id.startsWith("golden-") && ["dedup", "conflict", "forgetting"].includes(c.suite),
    )
    expect(goldenOther.length).toBe(20) // 8 + 7 + 5
  })
})
