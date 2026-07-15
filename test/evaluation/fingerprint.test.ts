import { describe, test, expect } from "vitest"
import { extractKeywords, jaccardSimilarity, computeFingerprint, shouldMerge } from "../../src/evaluation/fingerprint.js"

describe("extractKeywords", () => {
  test("extracts meaningful words > 3 chars", () => {
    const keywords = extractKeywords("YOLOv11 training optimization with CUDA tuning")
    expect(keywords).toContain("yolov11")
    expect(keywords).toContain("training")
    expect(keywords).toContain("optimization")
    expect(keywords).toContain("cuda")
    expect(keywords).toContain("tuning")
  })

  test("filters out common stop words", () => {
    const keywords = extractKeywords("the user is working on a project")
    expect(keywords).not.toContain("the")
    expect(keywords).not.toContain("user")
    expect(keywords).toContain("working")
    expect(keywords).toContain("project")
  })

  test("handles empty string", () => {
    expect(extractKeywords("")).toEqual([])
  })
})

describe("jaccardSimilarity", () => {
  test("identical sets return 1.0", () => {
    expect(jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["a", "b", "c"]))).toBe(1.0)
  })

  test("disjoint sets return 0", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0)
  })

  test("partial overlap returns correct ratio", () => {
    const a = new Set(["a", "b", "c", "d"])
    const b = new Set(["a", "b", "e", "f"])
    // intersection = 2, union = 6
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 6, 2)
  })
})

describe("computeFingerprint", () => {
  test("returns keyword set from content", () => {
    const fp = computeFingerprint("# YOLO Training\nWorking on YOLOv11 with CUDA")
    expect(fp.has("yolov11")).toBe(true)
    expect(fp.has("training")).toBe(true)
    expect(fp.has("cuda")).toBe(true)
  })

  test("strips frontmatter before extraction", () => {
    const fp = computeFingerprint("---\nname: Test\ntype: project\n---\n# Redis Cache\nRedis timeout configuration")
    expect(fp.has("redis")).toBe(true)
    expect(fp.has("timeout")).toBe(true)
    expect(fp.has("cache")).toBe(true)
    // frontmatter fields should not be keywords
    expect(fp.has("project")).toBe(false)
  })
})

describe("shouldMerge", () => {
  test("returns true for high-similarity content", () => {
    const a = "# YOLO Training\nYOLOv11 training optimization with CUDA"
    const b = "# Training YOLO\nYOLOv11 CUDA optimization work"
    expect(shouldMerge(a, b)).toBe(true)
  })

  test("returns false for dissimilar content", () => {
    const a = "# YOLO Training\nYOLOv11 training optimization"
    const b = "# Redis Config\nRedis timeout configuration"
    expect(shouldMerge(a, b)).toBe(false)
  })

  test("respects custom threshold", () => {
    const a = "# YOLO Training\nYOLOv11 training optimization CUDA"
    const b = "# Redis Config\nRedis timeout configuration database"
    // very different — should not merge even at low threshold
    expect(shouldMerge(a, b, 0.1)).toBe(false)
  })
})
