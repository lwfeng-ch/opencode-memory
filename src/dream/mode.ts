/**
 * opencode-memory — DreamMode (v0.5.0)
 *
 * Controls which Dream pipeline is active:
 * - "classic": legacy src/dream.ts 4-phase pipeline (ORIENT/GATHER/CONSOLIDATE/PRUNE)
 * - "v0.5": new Discovery Engine pipeline (Cluster → Evidence → Candidate → Proposal)
 * - "hybrid": v0.5 Discovery + classic Consolidate (transition)
 */

export type DreamMode = "classic" | "v0.5" | "hybrid"