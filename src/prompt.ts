/**
 * opencode-memory — System prompt builder
 *
 * Constructs the behavioral instructions, type taxonomy, write protocol,
 * and MEMORY.md index content that together form the memory system prompt.
 *
 * Four exports:
 *   truncateEntrypoint    — Cap MEMORY.md to line/byte limits
 *   buildMemoryPrompt     — Full memory instructions + index (single-store)
 *   buildScopedMemoryPrompt — Full memory instructions + dual-scope sections (dual-store)
 *   buildDailyLogPrompt   — KAIROS append-only log prompt
 */

import type { MemoryPluginConfig } from "./config.js"
import type { MemoryStore } from "./store.js"
import { ENTRYPOINT_NAME } from "./store.js"

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Result of truncating MEMORY.md content. */
export interface EntrypointTruncation {
  content: string
  lineCount: number
  byteCount: number
  wasLineTruncated: boolean
  wasByteTruncated: boolean
}

// ---------------------------------------------------------------------------
// truncateEntrypoint
// ---------------------------------------------------------------------------

/**
 * Truncate MEMORY.md content to line AND byte caps.
 *
 * If either cap is exceeded, the content is trimmed, then a warning line is
 * appended explaining why. The truncation is cooperative — it cuts at line
 * breaks, never mid-line, so markdown structure is preserved.
 *
 * @param raw       Raw MEMORY.md content
 * @param maxLines  Maximum allowed lines (applied first)
 * @param maxBytes  Maximum allowed bytes (applied second)
 * @returns         Truncation result with applied limits and status flags
 */
export function truncateEntrypoint(
  raw: string,
  maxLines: number,
  maxBytes: number,
): EntrypointTruncation {
  const trimmed = raw.trim()
  const lines = trimmed.split("\n")
  const lineCount = lines.length
  const byteCount = new TextEncoder().encode(trimmed).length

  let wasLineTruncated = false
  let wasByteTruncated = false
  let content: string

  // Fast path — neither cap exceeded
  if (lineCount <= maxLines && byteCount <= maxBytes) {
    return {
      content: trimmed,
      lineCount,
      byteCount,
      wasLineTruncated: false,
      wasByteTruncated: false,
    }
  }

  // 1. Line truncation (applied first)
  if (lineCount > maxLines) {
    content = lines.slice(0, maxLines).join("\n")
    wasLineTruncated = true
  } else {
    content = trimmed
  }

  // 2. Byte truncation (applied second — operates on line-truncated content)
  if (byteCount > maxBytes) {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(content)
    if (bytes.length > maxBytes) {
      // Find the last newline byte before maxBytes to avoid
      // splitting mid-character for multi-byte UTF-8 sequences.
      const slicePoint = bytes.lastIndexOf(0x0a, maxBytes)
      if (slicePoint > 0) {
        content = new TextDecoder().decode(bytes.slice(0, slicePoint))
      } else {
        // No newline found in range — hard cut at maxBytes (rare edge case)
        content = new TextDecoder().decode(bytes.slice(0, maxBytes))
      }
      wasByteTruncated = true
    }
  }

  // Build composite reason string
  const reasons: string[] = []
  if (wasLineTruncated) reasons.push("line count exceeds maximum")
  if (wasByteTruncated) reasons.push("byte size exceeds maximum")
  const reason = reasons.join(" and ")

  // Append warning
  content +=
    `\n\n> WARNING: ${ENTRYPOINT_NAME} is ${reason}. Only part loaded. ` +
    `Keep entries to one line under ~200 chars; move detail into topic files.`

  // Recalculate final counts
  const finalLines = content.split("\n")
  const finalBytes = new TextEncoder().encode(content).length

  return {
    content,
    lineCount: finalLines.length,
    byteCount: finalBytes,
    wasLineTruncated,
    wasByteTruncated,
  }
}

// ---------------------------------------------------------------------------
// Type taxonomy descriptions (shared between prompt builders)
// ---------------------------------------------------------------------------

const TYPE_TAXONOMY_SECTION = `## Types of memory

There are several discrete types of memory that you can store in your memory system:

<types>
<type>
    <name>user</name>
    <description>Contain information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your future behavior to the user's preferences and perspective. Your goal in reading and writing these memories is to build up an understanding of who the user is and how you can be most helpful to them specifically. For example, you should collaborate with a senior software engineer differently than a student who is coding for the very first time. Keep in mind, that the aim here is to be helpful to the user. Avoid writing memories about the user that could be viewed as a negative judgement or that are not relevant to the work you're trying to accomplish together.</description>
    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge</when_to_save>
    <how_to_use>When your work should be informed by the user's profile or perspective. For example, if the user is asking you to explain a part of the code, you should answer that question in a way that is tailored to the specific details that they will find most valuable or that helps them build their mental model in relation to domain knowledge they already have.</how_to_use>
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. These are a very important type of memory to read and write as they allow you to remain coherent and responsive to the way you should approach work in the project. Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated, and may grow overly cautious.</description>
    <when_to_save>Any time the user corrects your approach ("no not that", "don't", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that", accepting an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — watch for them. In both cases, save what is applicable to future conversations, especially if surprising or not obvious from the code. Include *why* so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so that the user does not need to offer the same guidance twice.</how_to_use>
</type>
<type>
    <name>project</name>
    <description>Information that you learn about ongoing work, goals, initiatives, bugs, or incidents within the project that is not otherwise derivable from the code or git history. Project memories help you understand the broader context and motivation behind the work the user is doing within this working directory.</description>
    <when_to_save>When you learn who is doing what, why, or by when. These states change relatively quickly so try to keep your understanding of this up to date. Always convert relative dates in user messages to absolute dates when saving (e.g., "Thursday" → "2026-03-05"), so the memory remains interpretable after time passes.</when_to_save>
    <how_to_use>Use these memories to more fully understand the details and nuance behind the user's request and make better informed suggestions.</how_to_use>
</type>
<type>
    <name>reference</name>
    <description>Stores pointers to where information can be found in external systems. These memories allow you to remember where to look to find up-to-date information outside of the project directory.</description>
    <when_to_save>When you learn about resources in external systems and their purpose. For example, that bugs are tracked in a specific project in Linear or that feedback can be found in a specific Slack channel.</when_to_save>
    <how_to_use>When the user references an external system or information that may be in an external system.</how_to_use>
</type>
</types>`

// ---------------------------------------------------------------------------
// buildMemoryPrompt
// ---------------------------------------------------------------------------

/**
 * Build the full memory system prompt (instructions + MEMORY.md index content).
 *
 * The constructed string includes:
 * - Header and memory directory guidance
 * - Type taxonomy (4 types with descriptions)
 * - What NOT to save in memory
 * - How to save (two-step process with frontmatter)
 * - When to access memory (with staleness caveats)
 * - MEMORY.md index content (or "empty" fallback)
 *
 * @param store  MemoryStore instance (to read MEMORY.md)
 * @param config Plugin configuration (for entrypoint caps)
 * @returns      Full memory system prompt string
 */
export async function buildMemoryPrompt(
  store: MemoryStore,
  config: MemoryPluginConfig,
): Promise<string> {
  const parts: string[] = []

  // 1. Header
  parts.push("# Auto Memory")
  parts.push("")

  // 2. Memory directory path and guidance
  const dir = store.getDir()
  parts.push(
    `You have a persistent, file-based memory system at \`${dir}\`. ` +
      `This directory already exists — write to it directly (do not run mkdir or check for its existence).`,
  )
  parts.push("")

  parts.push(
    `You should build up this memory system over time so that future conversations ` +
      `can have a complete picture of who the user is, how they'd like to collaborate ` +
      `with you, what behaviors to avoid or repeat, and the context behind the work ` +
      `the user gives you.`,
  )
  parts.push("")

  parts.push(
    `If the user explicitly asks you to remember something, save it immediately as ` +
      `whichever type fits best. If they ask you to forget something, find and remove ` +
      `the relevant entry.`,
  )
  parts.push("")

  // 3. Type taxonomy
  parts.push(TYPE_TAXONOMY_SECTION)
  parts.push("")

  // 4. What NOT to save
  parts.push("## What NOT to save in memory")
  parts.push("")
  parts.push(
    "- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.",
  )
  parts.push(
    "- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.",
  )
  parts.push(
    "- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.",
  )
  parts.push(
    "- Anything already documented in AGENTS.md or project config files.",
  )
  parts.push(
    "- Ephemeral task details: in-progress work, temporary state, current conversation context.",
  )
  parts.push("")
  parts.push(
    `These exclusions apply even when the user explicitly asks you to save. ` +
      `If they ask you to save a PR list or activity summary, ask what was *surprising* ` +
      `or *non-obvious* about it — that is the part worth keeping.`,
  )
  parts.push("")

  // 5. How to save
  parts.push("## How to save memories")
  parts.push("")
  parts.push(
    "Saving a memory is a two-step process:",
  )
  parts.push("")
  parts.push("**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:")
  parts.push("")
  parts.push("```markdown")
  parts.push("---")
  parts.push("name: {{memory name}}")
  parts.push("description: {{one-line description — used to decide relevance in future conversations, so be specific}}")
  parts.push("type: {{user, feedback, project, reference}}")
  parts.push("---")
  parts.push("")
  parts.push("{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}")
  parts.push("```")
  parts.push("")
  parts.push(
    `**Step 2** — add a pointer to that file in ${ENTRYPOINT_NAME}. ` +
      `${ENTRYPOINT_NAME} is an index, not a memory — each entry should be one line, ` +
      `under ~150 characters: \`- [Title](file.md) — one-line hook\`. ` +
      `It has no frontmatter. Never write memory content directly into ${ENTRYPOINT_NAME}.`,
  )
  parts.push("")
  parts.push(
    `- ${ENTRYPOINT_NAME} is always loaded into your conversation context — lines after ${config.entrypoint.maxLines} will be truncated, so keep the index concise`,
  )
  parts.push(
    "- Keep the name, description, and type fields in memory files up-to-date with the content",
  )
  parts.push(
    "- Organize memory semantically by topic, not chronologically",
  )
  parts.push(
    "- Update or remove memories that turn out to be wrong or outdated",
  )
  parts.push(
    "- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.",
  )
  parts.push("")

  // 6. When to access
  parts.push("## When to access memories")
  parts.push(
    "- When memories seem relevant, or the user references prior-conversation work.",
  )
  parts.push(
    "- You MUST access memory when the user explicitly asks you to check, recall, or remember.",
  )
  parts.push(
    `- If the user says to *ignore* or *not use* memory: proceed as if ${ENTRYPOINT_NAME} were empty. ` +
      `Do not apply remembered facts, cite, compare against, or mention memory content.`,
  )
  parts.push(
    `- Memory records can become stale over time. Use memory as context for what was true at a given point in time. ` +
      `Before answering the user or building assumptions based solely on information in memory records, ` +
      `verify that the memory is still correct and up-to-date by reading the current state of the files or resources. ` +
      `If a recalled memory conflicts with current information, trust what you observe now — and update or remove ` +
      `the stale memory rather than acting on it.`,
  )
  parts.push("")

  // 7. Before recommending from memory
  parts.push("## Before recommending from memory")
  parts.push("")
  parts.push(
    "A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. " +
      "It may have been renamed, removed, or never merged. Before recommending it:",
  )
  parts.push("")
  parts.push("- If the memory names a file path: check the file exists.")
  parts.push("- If the memory names a function or flag: grep for it.")
  parts.push(
    "- If the user is about to act on your recommendation (not just asking about history), verify first.",
  )
  parts.push("")
  parts.push(
    '"The memory says X exists" is not the same as "X exists now."',
  )
  parts.push("")
  parts.push(
    "A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. " +
      "If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.",
  )
  parts.push("")

  // 8. Memory and other forms of persistence
  parts.push("## Memory and other forms of persistence")
  parts.push(
    "Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. " +
      "The distinction is often that memory can be recalled in future conversations and should not be used for persisting " +
      "information that is only useful within the scope of the current conversation.",
  )
  parts.push(
    "- When to use or update a plan instead of memory: If you are about to start a non-trivial implementation task and " +
      "would like to reach alignment with the user on your approach you should use a Plan rather than saving this information " +
      "to memory. Similarly, if you already have a plan within the conversation and you have changed your approach persist " +
      "that change by updating the plan rather than saving a memory.",
  )
  parts.push(
    "- When to use or update tasks instead of memory: When you need to break your work in current conversation into " +
      "discrete steps or keep track of your progress use tasks instead of saving to memory. Tasks are great for persisting " +
      "information about the work that needs to be done in the current conversation, but memory should be reserved for " +
      "information that will be useful in future conversations.",
  )
  parts.push("")

  // 9. Searching past context
  parts.push("## Searching past context")
  parts.push("")
  parts.push("When looking for past context:")
  parts.push("1. Search topic files in your memory directory:")
  parts.push("")
  parts.push("```")
  parts.push(`grep -rn "<search term>" ${dir.replace(/\\/g, "\\\\")} --include="*.md"`)
  parts.push("```")
  parts.push("")
  parts.push("2. Session transcript logs (last resort — large files, slow):")
  parts.push("")
  parts.push("```")
  parts.push(`grep -rn "<search term>" ${dir.replace(/\\/g, "\\\\")}/ --include="*.jsonl"`)
  parts.push("```")
  parts.push("")
  parts.push(
    'Use narrow search terms (error messages, file paths, function names) rather than broad keywords.',
  )
  parts.push("")

  // 10. MEMORY.md content section
  parts.push(`## ${ENTRYPOINT_NAME}`)
  parts.push("")
  parts.push(
    `Your ${ENTRYPOINT_NAME} is below. It is an index of all saved memory files.`,
  )
  parts.push("")

  // Read and inject the MEMORY.md content (or empty)
  const indexContent = await store.getIndex()
  if (indexContent !== null && indexContent.trim().length > 0) {
    const truncated = truncateEntrypoint(
      indexContent,
      config.entrypoint.maxLines,
      config.entrypoint.maxBytes,
    )
    parts.push(truncated.content)
  } else {
    parts.push(
      `*${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.*`,
    )
  }

  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// buildScopedMemoryPrompt
// ---------------------------------------------------------------------------

/**
 * Build the memory system prompt with segmented scope sections.
 *
 * When userScopeEnabled is true, injects two separate sections:
 * - "User Long-term Memory" (cross-project preferences)
 * - "Current Project Memory" (project-specific context)
 *
 * Project memories are declared as overriding user memories on conflict.
 */
export async function buildScopedMemoryPrompt(
  userStore: MemoryStore,
  projectStore: MemoryStore,
  config: MemoryPluginConfig,
): Promise<string> {
  const parts: string[] = []
  const userDir = userStore.getDir()
  const projectDir = projectStore.getDir()

  // 1. Header
  parts.push("# Auto Memory")
  parts.push("")

  // 2. Memory directory guidance (dual-store)
  parts.push(
    "You have a persistent, file-based memory system split across two scopes:",
  )
  parts.push("")
  parts.push(`- **User scope** (cross-project): \`${userDir}\``)
  parts.push(`- **Project scope** (per-project): \`${projectDir}\``)
  parts.push("")
  parts.push(
    "Both directories already exist — write to them directly (do not run mkdir or check for their existence).",
  )
  parts.push("")
  parts.push(
    "You should build up this memory system over time so that future conversations " +
      "can have a complete picture of who the user is, how they'd like to collaborate " +
      "with you, what behaviors to avoid or repeat, and the context behind the work " +
      "the user gives you.",
  )
  parts.push("")
  parts.push(
    "If the user explicitly asks you to remember something, save it immediately as " +
      "whichever type fits best. If they ask you to forget something, find and remove " +
      "the relevant entry.",
  )
  parts.push("")

  // 3. Type taxonomy
  parts.push(TYPE_TAXONOMY_SECTION)
  parts.push("")

  // 4. What NOT to save
  parts.push("## What NOT to save in memory")
  parts.push("")
  parts.push(
    "- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.",
  )
  parts.push(
    "- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.",
  )
  parts.push(
    "- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.",
  )
  parts.push("- Anything already documented in AGENTS.md or project config files.")
  parts.push(
    "- Ephemeral task details: in-progress work, temporary state, current conversation context.",
  )
  parts.push("")
  parts.push(
    "These exclusions apply even when the user explicitly asks you to save. " +
      "If they ask you to save a PR list or activity summary, ask what was *surprising* " +
      "or *non-obvious* about it — that is the part worth keeping.",
  )
  parts.push("")

  // 5. Memory scope section
  parts.push("## Memory scope")
  parts.push("")
  parts.push("Memories have two scopes:")
  parts.push("")
  parts.push(`- **user** (cross-project): stored at \`${userDir}\` — shared across ALL projects`)
  parts.push(
    `- **project** (per-project): stored at \`${projectDir}\` — isolated to this project`,
  )
  parts.push("")
  parts.push(
    "Default routing by type (you don't need to specify scope unless overriding):",
  )
  parts.push("")
  parts.push("- `user` → user scope (identity is cross-project)")
  parts.push("- `feedback` → user scope (preferences usually apply everywhere)")
  parts.push(
    "- `project` → project scope (project context is project-specific)",
  )
  parts.push(
    "- `reference` → project scope (pointers to project resources)",
  )
  parts.push("")
  parts.push("When to override:")
  parts.push(
    '- A feedback that only applies to THIS project → set `scope: "project"`',
  )
  parts.push(
    '- A reference that applies across projects → set `scope: "user"`',
  )
  parts.push("")

  // 5b. Priority override (if configured)
  if (config.scope.projectOverridesUser) {
    parts.push(
      "**Priority:** Project memories override user memories when conflicts exist.",
    )
    parts.push(
      'For example, if user memory says "prefers PostgreSQL" but project memory says',
    )
    parts.push(
      '"must use MySQL", follow the project memory.',
    )
    parts.push("")
  }

  // 6. How to save
  parts.push("## How to save memories")
  parts.push("")
  parts.push("Saving a memory is a two-step process:")
  parts.push("")
  parts.push(
    "**Step 1** — write the memory to its own file using this frontmatter format:",
  )
  parts.push("")
  parts.push("```markdown")
  parts.push("---")
  parts.push("name: {{memory name}}")
  parts.push(
    "description: {{one-line description — used to decide relevance in future conversations, so be specific}}",
  )
  parts.push("type: {{user, feedback, project, reference}}")
  parts.push(
    "scope: {{user, project}}    ← optional, defaults to type-based routing",
  )
  parts.push(
    "confidence: {{explicit, inferred, uncertain}}  ← optional, default: inferred",
  )
  parts.push("---")
  parts.push("")
  parts.push(
    "{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}",
  )
  parts.push("```")
  parts.push("")
  parts.push(
    `**Step 2** — add a pointer to that file in ${ENTRYPOINT_NAME}. ` +
      `${ENTRYPOINT_NAME} is an index, not a memory — each entry should be one line, ` +
      `under ~150 characters: \`- [Title](file.md) — one-line hook\`. ` +
      `It has no frontmatter. Never write memory content directly into ${ENTRYPOINT_NAME}.`,
  )
  parts.push("")
  parts.push(
    `Choose the right scope directory when saving: user-scope memories go under the user ` +
      `directory, project-scoped memories go under the project directory. ` +
      `The \`scope\` field in frontmatter determines routing.`,
  )
  parts.push("")
  parts.push(
    `- ${ENTRYPOINT_NAME} is always loaded into your conversation context — lines after ${config.entrypoint.maxLines} will be truncated, so keep the index concise`,
  )
  parts.push(
    "- Keep the name, description, type, scope, and confidence fields in memory files up-to-date with the content",
  )
  parts.push(
    "- Organize memory semantically by topic, not chronologically",
  )
  parts.push(
    "- Update or remove memories that turn out to be wrong or outdated",
  )
  parts.push(
    "- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.",
  )
  parts.push("")

  // 7. When to access
  parts.push("## When to access memories")
  parts.push(
    "- When memories seem relevant, or the user references prior-conversation work.",
  )
  parts.push(
    "- You MUST access memory when the user explicitly asks you to check, recall, or remember.",
  )
  parts.push(
    `- If the user says to *ignore* or *not use* memory: proceed as if ${ENTRYPOINT_NAME} were empty. ` +
      `Do not apply remembered facts, cite, compare against, or mention memory content.`,
  )
  parts.push(
    `- Memory records can become stale over time. Use memory as context for what was true at a given point in time. ` +
      `Before answering the user or building assumptions based solely on information in memory records, ` +
      `verify that the memory is still correct and up-to-date by reading the current state of the files or resources. ` +
      `If a recalled memory conflicts with current information, trust what you observe now — and update or remove ` +
      `the stale memory rather than acting on it.`,
  )
  parts.push("")

  // 8. Before recommending from memory
  parts.push("## Before recommending from memory")
  parts.push("")
  parts.push(
    "A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. " +
      "It may have been renamed, removed, or never merged. Before recommending it:",
  )
  parts.push("")
  parts.push("- If the memory names a file path: check the file exists.")
  parts.push("- If the memory names a function or flag: grep for it.")
  parts.push(
    "- If the user is about to act on your recommendation (not just asking about history), verify first.",
  )
  parts.push("")
  parts.push(
    '"The memory says X exists" is not the same as "X exists now."',
  )
  parts.push("")
  parts.push(
    "A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. " +
      "If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.",
  )
  parts.push("")

  // 9. Memory and other forms of persistence
  parts.push("## Memory and other forms of persistence")
  parts.push(
    "Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. " +
      "The distinction is often that memory can be recalled in future conversations and should not be used for persisting " +
      "information that is only useful within the scope of the current conversation.",
  )
  parts.push(
    "- When to use or update a plan instead of memory: If you are about to start a non-trivial implementation task and " +
      "would like to reach alignment with the user on your approach you should use a Plan rather than saving this information " +
      "to memory. Similarly, if you already have a plan within the conversation and you have changed your approach persist " +
      "that change by updating the plan rather than saving a memory.",
  )
  parts.push(
    "- When to use or update tasks instead of memory: When you need to break your work in current conversation into " +
      "discrete steps or keep track of your progress use tasks instead of saving to memory. Tasks are great for persisting " +
      "information about the work that needs to be done in the current conversation, but memory should be reserved for " +
      "information that will be useful in future conversations.",
  )
  parts.push("")

  // 10. Searching past context
  parts.push("## Searching past context")
  parts.push("")
  parts.push("When looking for past context:")
  parts.push("1. Search topic files in the appropriate scope directory:")
  parts.push("")
  parts.push("```")
  parts.push(
    `# User scope: grep -rn "<search term>" ${userDir.replace(/\\/g, "\\\\")} --include="*.md"`,
  )
  parts.push(
    `# Project scope: grep -rn "<search term>" ${projectDir.replace(/\\/g, "\\\\")} --include="*.md"`,
  )
  parts.push("```")
  parts.push("")
  parts.push("2. Session transcript logs (last resort — large files, slow):")
  parts.push("")
  parts.push("```")
  parts.push(
    `grep -rn "<search term>" ${projectDir.replace(/\\/g, "\\\\")}/ --include="*.jsonl"`,
  )
  parts.push("```")
  parts.push("")
  parts.push(
    "Use narrow search terms (error messages, file paths, function names) rather than broad keywords.",
  )
  parts.push("")

  // 11. User Long-term Memory section
  parts.push("## User Long-term Memory")
  parts.push("")
  parts.push(
    `Cross-project user memories from \`${userDir}\` are below. ` +
      "These capture identity, role, preferences, and feedback that apply across ALL projects.",
  )
  parts.push("")

  const userIndex = await userStore.getIndex()
  if (userIndex !== null && userIndex.trim().length > 0) {
    const truncated = truncateEntrypoint(
      userIndex,
      config.entrypoint.maxLines,
      config.entrypoint.maxBytes,
    )
    parts.push(truncated.content)
  } else {
    parts.push("*No user memories saved yet. They will appear here when created.*")
  }
  parts.push("")

  // 12. Current Project Memory section
  parts.push("## Current Project Memory")
  parts.push("")
  parts.push(
    `Project-specific memories from \`${projectDir}\` are below. ` +
      "These capture context, decisions, and references for THIS project.",
  )
  if (config.scope.projectOverridesUser) {
    parts.push(
      " Project memories override user memories on conflict.",
    )
  }
  parts.push("")

  const projectIndex = await projectStore.getIndex()
  if (projectIndex !== null && projectIndex.trim().length > 0) {
    const truncated = truncateEntrypoint(
      projectIndex,
      config.entrypoint.maxLines,
      config.entrypoint.maxBytes,
    )
    parts.push(truncated.content)
  } else {
    parts.push(
      "*No project memories saved yet. They will appear here when created.*",
    )
  }

  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// buildDailyLogPrompt
// ---------------------------------------------------------------------------

/**
 * Build the KAIROS daily-log system prompt for append-only memory logging.
 *
 * The prompt instructs the model to append timestamped bullet entries to a
 * dated log file at `<memoryDir>/logs/YYYY/MM/YYYY-MM-DD.md`. The log is
 * append-only — no rewriting or editing of prior entries.
 *
 * Entries worth logging include:
 * - Corrections the user gave about approach or code
 * - Facts about the user (role, preferences, expertise)
 * - Project context (decisions, blockers, goals, deadlines)
 * - Pointers to external systems (dashboards, issue trackers, docs)
 * - Anything the user explicitly says to remember
 *
 * @param memoryDir  Absolute path to the memory directory
 * @returns          Daily-log prompt string
 */
export function buildDailyLogPrompt(memoryDir: string): string {
  // Normalise path separators for display
  const normalised = memoryDir.replace(/\\/g, "/")

  return [
    `# KAIROS Daily Log`,
    ``,
    `You maintain an append-only daily log at:`,
    ``,
    `\`${normalised}/logs/YYYY/MM/YYYY-MM-DD.md\``,
    ``,
    `## Rules`,
    ``,
    `- **Append only.** Never rewrite, edit, or reorder existing entries.`,
    `- Each entry is a single bullet line prefixed with a timestamp: \`- HH:MM <content>\``,
    `- Start a fresh file each day. If today's file exists, append to it.`,
    `- A separate nightly process (Dream) distills the daily log into structured memory files — do not try to organise entries yourself.`,
    ``,
    `## What to log`,
    ``,
    `Log these when they occur:`,
    ``,
    `- **Corrections** — the user corrects your approach, output, or understanding`,
    `- **Facts about the user** — role, goals, domain expertise, preferences (e.g. "prefers Rust over Go for CLI tools")`,
    `- **Project context** — decisions, blockers, deadlines, stakeholder asks, architecture choices`,
    `- **External pointers** — URLs, dashboard links, issue tracker references, documentation sources`,
    `- **Explicit requests** — "remember this", "save this for later", "note that"`,
    ``,
    `## What NOT to log`,
    ``,
    `- Code snippets, error messages, or debugging steps (these belong in the codebase, not memory)`,
    `- Already obvious project facts (the user's name, the repo name, the framework in use)`,
    `- Every user message — only signal, not noise`,
  ].join("\n")
}
