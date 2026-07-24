export const nodeColors = { memoryFact: "#3b82f6", conflict: "#ef4444", evidence: "#a855f7", proposal: "#f59e0b", execution: "#22c55e" } as const;
export const edgeStyles = {
  derived_from: { stroke: "#71717a", strokeWidth: 1.5 },
  supports: { stroke: "#22c55e", strokeWidth: 1.5, strokeDasharray: "5,5" },
  conflicts: { stroke: "#ef4444", strokeWidth: 2 },
  merged_into: { stroke: "#22c55e", strokeWidth: 1.5, strokeDasharray: "3,3" },
  results_in: { stroke: "#3b82f6", strokeWidth: 1.5 },
} as const;
