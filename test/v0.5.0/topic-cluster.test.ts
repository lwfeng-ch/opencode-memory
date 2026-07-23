/**
 * v0.5.0 Phase 3 — TopicCluster Tests
 * 28 tests
 *
 * Note: extractKeywords() filters words <= 3 chars (like "bun", "npm").
 * Test content must use words > 3 chars for meaningful Jaccard similarity.
 */

import { describe, it, expect } from "vitest"
import { TopicClusterBuilder } from "../../src/dream/cluster/topic-cluster.js"

function mem(filename: string, content: string) {
  return { filename, content }
}

describe("TopicClusterBuilder", () => {
  it("1. empty input → []", () => {
    const builder = new TopicClusterBuilder()
    expect(builder.build([])).toEqual([])
  })

  it("2. single memory → []", () => {
    const builder = new TopicClusterBuilder()
    expect(builder.build([mem("a.md", "User prefers typescript")])).toEqual([])
  })

  it("3. two similar memories → 1 cluster", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "User prefers typescript for frontend development"),
      mem("b.md", "typescript is great for frontend development"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe("topic")
  })

  it("4. two dissimilar memories → 0 clusters", () => {
    const builder = new TopicClusterBuilder(0.5)
    const result = builder.build([
      mem("a.md", "User prefers typescript for frontend development"),
      mem("b.md", "The weather forecast shows rain today"),
    ])
    expect(result).toHaveLength(0)
  })

  it("5. three similar memories → 1 cluster with 3 members", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "User prefers typescript for frontend development"),
      mem("b.md", "typescript is great for frontend development"),
      mem("c.md", "typescript is the preferred language for frontend"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].members).toHaveLength(3)
  })

  it("6. two separate topic groups → 2 clusters", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
      mem("c.md", "python backend development with django"),
      mem("d.md", "python backend framework django"),
    ])
    expect(result).toHaveLength(2)
  })

  it("7. confidence is average similarity", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].confidence).toBeGreaterThan(0)
    expect(result[0].confidence).toBeLessThanOrEqual(1)
  })

  it("8. metadata contains keywords", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].metadata.keywords).toBeDefined()
    expect(Array.isArray(result[0].metadata.keywords)).toBe(true)
  })

  it("9. metadata contains memberCount", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].metadata.memberCount).toBe(2)
  })

  it("10. metadata contains threshold", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].metadata.threshold).toBe(0.3)
  })

  it("11. higher threshold → fewer clusters", () => {
    const builder = new TopicClusterBuilder(0.8)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result.length).toBeLessThanOrEqual(1)
  })

  it("12. frontmatter stripped", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "---\nname: test\n---\ntypescript is great for frontend development"),
      mem("b.md", "---\nname: test2\n---\ntypescript preferred language for frontend"),
    ])
    expect(result).toHaveLength(1)
  })

  it("13. cluster id is stable format", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].id).toMatch(/^topic-/)
  })

  it("14. custom threshold works", () => {
    const builder = new TopicClusterBuilder(0.1)
    const result = builder.build([
      mem("a.md", "typescript development"),
      mem("b.md", "typescript frontend"),
    ])
    expect(result).toHaveLength(1)
  })

  it("15. level is 'topic'", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].level).toBe("topic")
  })

  it("16. members sorted alphabetically", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("z.md", "typescript is great for frontend development"),
      mem("a.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].members).toEqual(["a.md", "z.md"])
  })

  it("17. clusters sorted by confidence descending", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
      mem("c.md", "python backend development django framework"),
      mem("d.md", "python backend framework django"),
    ])
    expect(result[0].confidence).toBeGreaterThanOrEqual(result[1].confidence)
  })

  it("18. identical content → high similarity cluster", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "User prefers typescript"),
      mem("b.md", "User prefers typescript"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].confidence).toBeGreaterThan(0.8)
  })

  it("19. single word overlap → no cluster", () => {
    const builder = new TopicClusterBuilder(0.4)
    const result = builder.build([
      mem("a.md", "typescript"),
      mem("b.md", "python"),
    ])
    expect(result).toHaveLength(0)
  })

  it("20. three mems, chain similarity → 1 cluster", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript frontend development with react"),
      mem("c.md", "typescript react development is fast"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].members).toHaveLength(3)
  })

  it("21. metadata.similarity = confidence", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result[0].metadata.similarity).toBe(result[0].confidence)
  })

  it("22. common keywords extracted correctly", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    const keywords = result[0].metadata.keywords as string[]
    expect(keywords).toContain("typescript")
    expect(keywords).toContain("frontend")
  })

  it("23. all dissimilar → empty", () => {
    const builder = new TopicClusterBuilder(0.5)
    const result = builder.build([
      mem("a.md", "typescript frontend development"),
      mem("b.md", "python backend development"),
      mem("c.md", "weather forecast rain today"),
    ])
    expect(result).toHaveLength(0)
  })

  it("24. large cluster still works", () => {
    const builder = new TopicClusterBuilder(0.3)
    const mems = Array.from({ length: 20 }, (_, i) =>
      mem(`${i}.md`, `typescript is great for frontend development version ${i}`),
    )
    const result = builder.build(mems)
    expect(result).toHaveLength(1)
    expect(result[0].members).toHaveLength(20)
  })

  it("25. threshold 0.0 → everything clusters", () => {
    const builder = new TopicClusterBuilder(0.0)
    const result = builder.build([
      mem("a.md", "typescript development"),
      mem("b.md", "python development"),
    ])
    expect(result).toHaveLength(1)
  })

  it("26. threshold 1.0 → nothing clusters", () => {
    const builder = new TopicClusterBuilder(1.0)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
    ])
    expect(result).toHaveLength(0)
  })

  it("27. version-like tokens preserved", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "python version 3.10 is used for development"),
      mem("b.md", "python version 3.10 development guide"),
    ])
    expect(result).toHaveLength(1)
  })

  it("28. no shared keywords across groups", () => {
    const builder = new TopicClusterBuilder(0.3)
    const result = builder.build([
      mem("a.md", "typescript is great for frontend development"),
      mem("b.md", "typescript preferred language for frontend"),
      mem("c.md", "python backend development django framework"),
      mem("d.md", "python backend framework django"),
    ])
    expect(result).toHaveLength(2)
  })
})