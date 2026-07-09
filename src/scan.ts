/**
 * opencode-memory — Directory scanning and manifest formatting
 *
 * Pure presentation layer: reads memory headers from the store and formats
 * them for system prompt injection. No I/O beyond the store interface.
 */

import type { MemoryHeader } from "./config.js";
import type { MemoryStore } from "./store.js";
import { memoryAge, memoryFreshnessNote } from "./staleness.js";

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/**
 * Scan memory directory for .md files, read frontmatter, return headers
 * sorted newest-first. Delegates to store.list().
 */
export async function scanMemoryFiles(
  store: MemoryStore,
): Promise<MemoryHeader[]> {
  return store.list();
}

// ---------------------------------------------------------------------------
// Manifest formatting
// ---------------------------------------------------------------------------

/**
 * Format memory headers as a text manifest: one line per file with
 * `[scope:type] filename (ISO timestamp): description`.
 *
 * Used by both the recall selector prompt and the extraction prompt.
 *
 * - With scope+type: `- [scope:type] filename (ISO timestamp): description`
 * - With type only (no scope): `- [type] filename (ISO timestamp): description`
 * - With neither: `- filename (ISO timestamp): description`
 * - With description: `: description` is appended
 * - Without description: the trailing `: ` is omitted.
 */
export function formatManifest(memories: MemoryHeader[]): string {
  return memories
    .map((m) => {
      const ts = new Date(m.mtimeMs).toISOString();
      const tag =
        m.scope !== undefined && m.type !== undefined
          ? `[${m.scope}:${m.type}] `
          : m.type !== undefined
            ? `[${m.type}] `
            : "";
      const desc = m.description !== null ? `: ${m.description}` : "";
      return `- ${tag}${m.filename} (${ts})${desc}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Selected-memory formatting (system prompt injection)
// ---------------------------------------------------------------------------

/**
 * Format selected memories for system prompt injection.
 *
 * Each memory is wrapped in a `<memory>` block with:
 * - filename, type, scope, and confidence attributes
 * - age attribute (human-readable, e.g. "3 days ago")
 * - An optional `<staleness>` caveat when the memory is older than
 *   `warnAfterDays`
 * - The full content of the memory file
 *
 * @param memories  - Headers for the selected memories.
 * @param content   - Map from filename to full file content.
 * @param warnAfterDays - Days before a staleness caveat is prepended.
 */
export function formatSelectedMemories(
  memories: MemoryHeader[],
  content: Map<string, string>,
  warnAfterDays: number,
): string {
  return memories
    .map((m) => formatMemoryBlock(m, content, warnAfterDays))
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Scope-grouped formatting (segmented prompt injection)
// ---------------------------------------------------------------------------

/**
 * Format memories grouped by scope for segmented prompt injection.
 * Returns two sections: user memories and project memories.
 * Project memories are listed first (higher priority).
 *
 * @param userMemories    - Headers for user-scoped memories.
 * @param projectMemories - Headers for project-scoped memories.
 * @param content         - Map from filename to full file content.
 * @param warnAfterDays   - Days before a staleness caveat is prepended.
 */
export function formatMemoriesByScope(
  userMemories: MemoryHeader[],
  projectMemories: MemoryHeader[],
  content: Map<string, string>,
  warnAfterDays: number,
): string {
  if (userMemories.length === 0 && projectMemories.length === 0) return "";

  const sections: string[] = [];

  if (projectMemories.length > 0) {
    sections.push(
      "## Current Project Memory\n\nThese memories describe this repository only. They override user preferences when conflicts exist.\n\n" +
        projectMemories
          .map((m) => formatMemoryBlock(m, content, warnAfterDays))
          .join("\n\n"),
    );
  }

  if (userMemories.length > 0) {
    sections.push(
      "## User Long-term Memory\n\nThese memories describe stable user preferences. They apply across projects.\n\n" +
        userMemories
          .map((m) => formatMemoryBlock(m, content, warnAfterDays))
          .join("\n\n"),
    );
  }

  return sections.join("\n\n");
}

/**
 * Render a single memory as a `<memory>` block.
 */
function formatMemoryBlock(
  m: MemoryHeader,
  content: Map<string, string>,
  warnAfterDays: number,
): string {
  const age = memoryAge(m.mtimeMs);
  const typeAttr = m.type !== undefined ? ` type="${m.type}"` : "";
  const scopeAttr = m.scope !== undefined ? ` scope="${m.scope}"` : "";
  const confidenceAttr = ` confidence="${m.confidence}"`;
  const staleness = memoryFreshnessNote(m.mtimeMs, warnAfterDays);
  const body = content.get(m.filename) ?? "";

  const parts: string[] = [
    `<memory filename="${m.filename}"${typeAttr}${scopeAttr}${confidenceAttr} age="${age}">`,
  ];

  if (staleness) {
    parts.push(staleness.trimEnd());
  }

  parts.push("---content---");
  parts.push(body);
  parts.push("---end---");
  parts.push("</memory>");

  return parts.join("\n");
}