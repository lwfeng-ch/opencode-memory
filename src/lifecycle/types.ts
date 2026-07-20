/**
 * opencode-memory — Lifecycle Types (v0.3.3)
 *
 * Memory lifecycle status and metadata.
 *
 * v0.3.3: fields only, no auto-trigger policies.
 * v0.4.0 will add LifecyclePolicyEngine with type-specific thresholds.
 *
 * "deleted" is NOT a memory file status — deleted files are removed
 * from store entirely. Delete action is recorded in audit log only.
 */

/** Memory lifecycle status. */
export type MemoryStatus = "active" | "archived"

/** Lifecycle metadata stored in memory file frontmatter. */
export interface LifecycleMetadata {
  /** "active" = normal, "archived" = deprioritized in recall (score * 0.1) */
  status: MemoryStatus
  /** Epoch ms — when memory was first written */
  createdAt: number
  /** Epoch ms — last recall hit (null = never recalled) */
  lastRecalledAt: number | null
  /** Epoch ms — when archived (null = not archived) */
  archivedAt: number | null
}

/** Default lifecycle for new memories and existing ones without lifecycle fields. */
export const DEFAULT_LIFECYCLE: LifecycleMetadata = {
  status: "active",
  createdAt: 0,
  lastRecalledAt: null,
  archivedAt: null,
}

/**
 * Parse lifecycle fields from frontmatter (already parsed as Record<string, string>).
 * Missing fields default to active/0/null.
 */
export function parseLifecycle(frontmatter: Record<string, string>): LifecycleMetadata {
  return {
    status: frontmatter.status === "archived" ? "archived" : "active",
    createdAt: frontmatter.createdAt ? Number(frontmatter.createdAt) || 0 : 0,
    lastRecalledAt: frontmatter.lastRecalledAt && frontmatter.lastRecalledAt !== "null"
      ? Number(frontmatter.lastRecalledAt) || null
      : null,
    archivedAt: frontmatter.archivedAt && frontmatter.archivedAt !== "null"
      ? Number(frontmatter.archivedAt) || null
      : null,
  }
}

/**
 * Recall score multiplier based on lifecycle status.
 * - active: 1.0 (full score)
 * - archived: 0.1 (10x deprioritized, but still searchable as last resort)
 */
export function lifecycleScoreMultiplier(status: MemoryStatus | undefined): number {
  if (status === "archived") return 0.1
  return 1.0
}
