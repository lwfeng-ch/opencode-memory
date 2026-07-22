/**
 * opencode-memory — ConflictGraph Builder (v0.4.2)
 *
 * Builds a conflict graph from extracted claims. Groups claims by
 * (subject, predicate) key, detects conflicts within each group,
 * and builds connected components for resolution ordering.
 *
 * See: docs/superpowers/specs/v0.4.2/03-conflict-graph.md
 */

import {
  type MemoryClaim,
  type ConflictGraph,
  type ConflictNode,
  type ConflictEdge,
  type ConflictComponent,
  DUPLICATE_MIN_SIMILARITY,
  SUPERSEDED_TIMESTAMP_THRESHOLD_MS,
  generateEdgeId,
  generateComponentId,
  formatClaimKey,
} from "./types.js"
import { containsSupersededSignal } from "./claim-extractor.js"

// ---------------------------------------------------------------------------
// BuildOptions
// ---------------------------------------------------------------------------

export interface BuildOptions {
  duplicateMinSimilarity?: number
  contradictionMinSimilarity?: number
  supersededTimestampThreshold?: number
}

// ---------------------------------------------------------------------------
// ConflictGraphBuilder
// ---------------------------------------------------------------------------

export class ConflictGraphBuilder {
  constructor(private options: BuildOptions = {}) {}

  /**
   * Build a conflict graph from a set of extracted claims.
   */
  build(claims: MemoryClaim[]): ConflictGraph {
    const nodes = this.buildNodes(claims)
    const edges = this.detectEdges(claims)
    const components = this.buildComponents(nodes, edges)

    return { nodes, edges, components }
  }

  /**
   * Build nodes from claims (one node per unique source memory).
   */
  private buildNodes(claims: MemoryClaim[]): ConflictNode[] {
    const nodeMap = new Map<string, MemoryClaim[]>()
    for (const claim of claims) {
      const existing = nodeMap.get(claim.sourceMemory) ?? []
      existing.push(claim)
      nodeMap.set(claim.sourceMemory, existing)
    }

    return Array.from(nodeMap.entries()).map(([id, nodeClaims]) => ({
      id,
      claims: nodeClaims,
    }))
  }

  /**
   * Detect conflicts between claims within the same (subject, predicate) group.
   */
  private detectEdges(claims: MemoryClaim[]): ConflictEdge[] {
    const edges: ConflictEdge[] = []

    // Group claims by (subject, predicate)
    const groups = new Map<string, MemoryClaim[]>()
    for (const claim of claims) {
      const key = formatClaimKey(claim.subject, claim.predicate)
      const existing = groups.get(key) ?? []
      existing.push(claim)
      groups.set(key, existing)
    }

    // Within each group, detect conflicts
    for (const [claimKey, groupClaims] of groups) {
      if (groupClaims.length < 2) continue

      // Generate all unique pairs
      for (let i = 0; i < groupClaims.length; i++) {
        for (let j = i + 1; j < groupClaims.length; j++) {
          const a = groupClaims[i]
          const b = groupClaims[j]

          // Skip self-conflict (same file)
          if (a.sourceMemory === b.sourceMemory) continue

          const edge = this.classifyPair(a, b, claimKey)
          if (edge) edges.push(edge)
        }
      }
    }

    return edges
  }

  /**
   * Classify a pair of claims as duplicate, contradiction, or superseded.
   */
  private classifyPair(
    a: MemoryClaim,
    b: MemoryClaim,
    claimKey: string,
  ): ConflictEdge | null {
    const dupMin = this.options.duplicateMinSimilarity ?? DUPLICATE_MIN_SIMILARITY
    const tsThreshold = this.options.supersededTimestampThreshold ?? SUPERSEDED_TIMESTAMP_THRESHOLD_MS

    // Same value → duplicate
    if (a.value.toLowerCase() === b.value.toLowerCase()) {
      return {
        id: generateEdgeId(),
        source: a.sourceMemory,
        target: b.sourceMemory,
        type: "duplicate",
        claimKey,
        confidence: dupMin,
      }
    }

    // Different values → contradiction or superseded
    // Check superseded signals
    const aSupersedes = containsSupersededSignal(a.value) || this.hasSupersededProvenance(a, b, tsThreshold)
    const bSupersedes = containsSupersededSignal(b.value) || this.hasSupersededProvenance(b, a, tsThreshold)

    if (aSupersedes || bSupersedes) {
      return {
        id: generateEdgeId(),
        source: a.sourceMemory,
        target: b.sourceMemory,
        type: "superseded",
        claimKey,
        confidence: 0.85,
      }
    }

    // Default: contradiction
    return {
      id: generateEdgeId(),
      source: a.sourceMemory,
      target: b.sourceMemory,
      type: "contradiction",
      claimKey,
      confidence: 0.75,
    }
  }

  /**
   * Check if claim A has provenance that supersedes claim B (newer timestamp).
   */
  private hasSupersededProvenance(
    a: MemoryClaim,
    b: MemoryClaim,
    threshold: number,
  ): boolean {
    const tsA = a.sourceProvenance?.created.timestamp
    const tsB = b.sourceProvenance?.created.timestamp
    if (!tsA || !tsB) return false
    return tsA > tsB + threshold
  }

  /**
   * Build connected components from edges using Union-Find.
   */
  private buildComponents(
    nodes: ConflictNode[],
    edges: ConflictEdge[],
  ): ConflictComponent[] {
    if (edges.length === 0) return []

    // Union-Find
    const parent = new Map<string, string>()

    const find = (x: string): string => {
      const p = parent.get(x)
      if (p === undefined) {
        parent.set(x, x)
        return x
      }
      if (p !== x) {
        parent.set(x, find(p))
      }
      return parent.get(x)!
    }

    const union = (a: string, b: string) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }

    // Initialize all nodes
    for (const node of nodes) {
      parent.set(node.id, node.id)
    }

    // Union all edges
    for (const edge of edges) {
      union(edge.source, edge.target)
    }

    // Group by root
    const componentMap = new Map<string, { memories: Set<string>; edges: ConflictEdge[] }>()
    for (const node of nodes) {
      const root = find(node.id)
      const existing = componentMap.get(root) ?? { memories: new Set<string>(), edges: [] }
      existing.memories.add(node.id)
      componentMap.set(root, existing)
    }

    for (const edge of edges) {
      const edgeRoot = find(edge.source)
      const existing = componentMap.get(edgeRoot)!
      existing.edges.push(edge)
    }

    return Array.from(componentMap.entries()).map(([root, data]) => ({
      id: generateComponentId(),
      memories: Array.from(data.memories).sort(),
      edges: data.edges,
      size: data.memories.size,
    }))
  }
}

// ---------------------------------------------------------------------------
// Resolution Ordering
// ---------------------------------------------------------------------------

export function getResolutionOrder(component: ConflictComponent): ConflictEdge[] {
  return [...component.edges].sort((a, b) => {
    // 1. Highest confidence first
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    // 2. Duplicates first (easiest to resolve)
    if (a.type === "duplicate" && b.type !== "duplicate") return -1
    if (b.type === "duplicate" && a.type !== "duplicate") return 1
    // 3. Superseded before contradiction
    if (a.type === "superseded" && b.type !== "superseded") return -1
    if (b.type === "superseded" && a.type !== "superseded") return 1
    return 0
  })
}

// ---------------------------------------------------------------------------
// Graph Queries
// ---------------------------------------------------------------------------

export function isInConflict(graph: ConflictGraph, filename: string): boolean {
  return graph.nodes.some((n) => n.id === filename)
}

export function getConflictedMemories(graph: ConflictGraph): Set<string> {
  return new Set(graph.nodes.map((n) => n.id))
}

export function getLargestComponentSize(graph: ConflictGraph): number {
  if (graph.components.length === 0) return 0
  return Math.max(...graph.components.map((c) => c.size))
}