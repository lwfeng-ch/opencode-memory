/**
 * opencode-memory — Dream Module Index (v0.5.0)
 *
 * Re-exports from the Dream module. The classic dream.ts pipeline
 * remains at src/dream.ts for backward compatibility.
 *
 * Usage:
 *   import { DreamMode } from "./dream/index.js"
 *   import { ConflictClusterAdapter } from "./dream/index.js"
 */

// Mode
export type { DreamMode } from "./mode.js"

// Cluster types
export type { MemoryCluster, ClusterLevel } from "./cluster/types.js"
export { generateClusterId } from "./cluster/types.js"

// Conflict Adapter
export { ConflictClusterAdapter } from "./cluster/conflict-adapter.js"

// Evidence
export type { EvidenceReport, EvidenceMember, MemoryFile } from "./analyzer/evidence.js"
export { EvidenceCollector, confidenceToScore, extractConfidence } from "./analyzer/evidence.js"

// Candidate types
export type { ConsolidationCandidate, CandidateAction } from "./candidate/types.js"
export { generateCandidateId } from "./candidate/types.js"

// Candidate Generator
export { CandidateGenerator } from "./candidate/generator.js"