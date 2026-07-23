/**
 * v0.5.0 Phase 2 — ClaimCluster Tests
 * 22 tests
 */

import { describe, it, expect } from "vitest"
import { ClaimClusterBuilder } from "../../src/dream/cluster/claim-cluster.js"

// Helper: claim-like content that triggers ClaimExtractor patterns
function mem(filename: string, content: string) {
  return { filename, content }
}

describe("ClaimClusterBuilder", () => {
  const builder = new ClaimClusterBuilder()

  it("1. empty input → []", () => {
    expect(builder.build([])).toEqual([])
  })

  it("2. single memory → []", () => {
    expect(builder.build([mem("a.md", "User prefers vscode")])).toEqual([])
  })

  it("3. two memories same claim → 1 cluster", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe("claim")
    expect(result[0].members).toEqual(["a.md", "b.md"])
  })

  it("4. two memories different claims → 0 clusters", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "Project uses python"),
    ])
    expect(result).toHaveLength(0)
  })

  it("5. multiple memories same claim → 1 cluster with all", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers cursor"),
      mem("c.md", "User prefers vim"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].members).toEqual(["a.md", "b.md", "c.md"])
  })

  it("6. metadata contains subject, predicate, values", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result[0].metadata.subject).toBe("user")
    expect(result[0].metadata.predicate).toBe("preference")
    expect(result[0].metadata.values).toContain("vscode")
    expect(result[0].metadata.values).toContain("cursor")
  })

  it("7. 'User uses' pattern → claim cluster", () => {
    const result = builder.build([
      mem("a.md", "User uses bun"),
      mem("b.md", "User uses node"),
    ])
    expect(result).toHaveLength(1)
  })

  it("8. 'Project uses' pattern → claim cluster", () => {
    const result = builder.build([
      mem("a.md", "Project uses react"),
      mem("b.md", "Project uses vue"),
    ])
    expect(result).toHaveLength(1)
  })

  it("9. 'Now using' pattern → claim cluster", () => {
    const result = builder.build([
      mem("a.md", "Now using pnpm"),
      mem("b.md", "Now using bun"),
    ])
    expect(result).toHaveLength(1)
  })

  it("10. 'Switched to' pattern → claim cluster", () => {
    const result = builder.build([
      mem("a.md", "Switched to typescript"),
      mem("b.md", "Switched to go"),
    ])
    expect(result).toHaveLength(1)
  })

  it("11. no claim patterns → fallback 'memory:about' claims form cluster", () => {
    const result = builder.build([
      mem("a.md", "Just some random text with no patterns"),
      mem("b.md", "More random unrelated text"),
    ])
    // Both get fallback "memory:about" claims → same key → cluster
    expect(result).toHaveLength(1)
    expect(result[0].metadata.subject).toBe("memory")
    expect(result[0].metadata.predicate).toBe("about")
  })

  it("12. mixed claims → separate clusters", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "Project uses react"),
      mem("c.md", "User prefers cursor"),
    ])
    // 2 clusters: user:preference (a, c) and project:uses (b alone → filtered)
    expect(result).toHaveLength(1)
    expect(result[0].metadata.subject).toBe("user")
  })

  it("13. values deduplication", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers vscode"),
    ])
    expect(result[0].metadata.values).toEqual(["vscode"])
  })

  it("14. frontmatter stripped properly", () => {
    const result = builder.build([
      mem("a.md", "---\nname: test\n---\nUser prefers vscode"),
      mem("b.md", "---\nname: test2\n---\nUser prefers cursor"),
    ])
    expect(result).toHaveLength(1)
  })

  it("15. duplicate claims in same file → single entry", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode\nUser prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].members).toEqual(["a.md", "b.md"])
  })

  it("16. cluster id is stable format", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result[0].id).toMatch(/^claim-/)
  })

  it("17. confidence defaults to 0.8", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result[0].confidence).toBe(0.8)
  })

  it("18. claimKey in metadata", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result[0].metadata.claimKey).toBe("user:preference")
  })

  it("19. case insensitive matching", () => {
    const result = builder.build([
      mem("a.md", "user prefers vscode"),
      mem("b.md", "User prefers cursor"),
    ])
    expect(result).toHaveLength(1)
  })

  it("20. multiple predicates on same subject", () => {
    const result = builder.build([
      mem("a.md", "User prefers vscode\nUser uses mac"),
      mem("b.md", "User prefers cursor"),
      mem("c.md", "User uses linux"),
    ])
    // Two clusters: user:preference (a,b) and user:uses (a,c)
    const pref = result.filter((c) => c.metadata.predicate === "preference")
    const uses = result.filter((c) => c.metadata.predicate === "uses")
    expect(pref).toHaveLength(1)
    expect(uses).toHaveLength(1)
  })

  it("21. 'Switched to' and 'User uses' → same claim cluster", () => {
    const result = builder.build([
      mem("a.md", "Switched to pnpm"),
      mem("b.md", "User uses yarn"),
    ])
    // Both map to user:uses
    expect(result).toHaveLength(1)
    expect(result[0].metadata.predicate).toBe("uses")
  })

  it("22. large input with no claims → fallback forms clusters", () => {
    const input = Array.from({ length: 10 }, (_, i) =>
      mem(`${i}.md`, `Random text ${i} with no claim patterns`),
    )
    // Each file gets "memory:about" fallback with different values → 10 different keys → no cluster
    // Actually each file has unique value ("Random text 0", "Random text 1"...) so they don't match
    // But they all share "memory:about" key → that's the same key → they all cluster
    // Wait: the key is "memory:about" which is the same for all → 1 cluster with 10 members
    const result = builder.build(input)
    expect(result).toHaveLength(1)
    expect(result[0].members).toHaveLength(10)
  })
})