# opencode-memory

English | [简体中文](README-zh.md)

Pipeline-centered, model-agnostic long-term memory system for [OpenCode](https://opencode.ai).

Inspired by Claude Code's memory pipeline and Qwen Code's fact-layer architecture, rebuilt for OpenCode's event-driven plugin architecture. Free-model first: every LLM call point is independently configurable with graceful degradation.

## Features

- **KAIROS Mode** — Append-only daily logs during active sessions (zero LLM cost), batch extraction on `session.idle`
- **Incremental Extraction** — Cursor-based message offset tracking; only new messages since the last extraction run are sent to the LLM (reduces cost on long sessions)
- **Two-Stage Recall** — Rule filter (free, zero model calls) + LLM rerank (one lightweight call on survivors only)
- **RecallHandle** — Async recall fires on `chat.message`, settles in background, injects on next `system.transform` turn — no blocking, no missed results
- **Active Tool Filter** — Transient tool-debug memories (e.g. "npm install failed") are filtered from recall when the tool is active; durable markers ("workaround", "known issue") survive
- **Memory Pressure** — 3-level detection (normal/elevated/critical) based on file count, index size, and total size; critical pressure bypasses dream time gate, elevated halves it
- **Dream Consolidation** — 4-phase pipeline: Orient → Gather → Consolidate → Prune, runs periodically with 3-gate scheduling + pressure-aware triggering
- **Entry-Level Deletion** — `memory_delete` supports `entryId` parameter for removing individual entries from multi-entry memory files, not just whole files
- **Telemetry** — Structured JSONL event logging (`logEvent`/`queryEvents`/`cleanupOldEvents`) for extraction, recall, and dream lifecycle — never blocks the pipeline
- **Cross-Project Scope** — User-level memories (global preferences) + project-level memories (per-repo context), with priority override
- **6 Custom Tools** — `memory_save`, `memory_list`, `memory_search`, `memory_read`, `memory_delete` (with entry-level), `memory_append`
- **Staleness Awareness** — Memories older than N days get point-in-time caveats injected into context
- **Model-Agnostic** — Free-model defaults (`explore`/`quick`/`deep` categories), every stage independently configurable with `resolveAgentConfig` safety check

## Architecture

```
src/
├── index.ts        Plugin entry — wires hooks (system.transform, chat.message, event, tool)
├── config.ts       Configuration, type taxonomy, scope resolver, resolveAgentConfig
├── store.ts        Storage abstraction (FileSystemStore), frontmatter parser, parseEntries/deleteEntry
├── paths.ts        Path resolution (project + user dirs, git root, cursor paths)
├── prompt.ts       System prompt builder (instructions + MEMORY.md index injection)
├── recall.ts       Two-stage recall: rule filter → LLM rerank, RecallHandle, isTransientToolMemory, pressure cache
├── extraction.ts   KAIROS session extraction on session.idle, cursor-based incremental processing
├── dream.ts        Dream consolidation: 4-phase pipeline + 3-gate scheduling + pressure-aware triggering
├── cursor.ts       Incremental extraction tracking (readCursor/writeCursor)
├── health.ts       Memory pressure detection (3-level), health score, status report
├── telemetry.ts    Structured JSONL event logging (logEvent/queryEvents/cleanupOldEvents)
├── scan.ts         Directory scanning + manifest/selection formatting
├── staleness.ts    Age computation + freshness caveats (pure, no I/O)
├── lock.ts         File-based mutual exclusion (PID + stale timeout)
└── tools.ts        6 custom tool definitions for the main agent
```

### Memory Pipeline

```
User Message
    │
    ▼
chat.message hook ──► Recall (async, RecallHandle)
    │                     │
    │              Stage 1: Rule filter (free) + transient tool filter
    │              Stage 2: LLM rerank (one call) — skipped on critical pressure
    │                     │
    ▼                     ▼
system.transform hook ──► Inject MEMORY.md index + recalled memories (from RecallHandle)
    │
    ▼
Agent runs (with memory context)
    │
    ▼
session.idle event ──► Extraction (batch, KAIROS, cursor-incremental)
                    └──► Dream consolidation (if gates pass + pressure-aware)
                              │
                              └──► Telemetry events (JSONL, non-blocking)
```

### Memory Types

| Type | Scope Default | Purpose |
|------|--------------|---------|
| `user` | user | User role, goals, preferences, expertise |
| `feedback` | user | Guidance on approach — corrections AND confirmations |
| `project` | project | Ongoing work context, decisions, deadlines |
| `reference` | project | Pointers to external systems (dashboards, trackers) |

Scope is loosely bound to type — the agent can override via the `scope` parameter in `memory_save`.

## Installation

### As an OpenCode Plugin

Add to your `opencode.jsonc`:

```jsonc
{
  "plugins": {
    "opencode-memory": {
      "path": "path/to/opencode-memory",
      "enabled": true
    }
  }
}
```

Or place the plugin directory under `~/.config/opencode/plugins/opencode-memory/`.

### Requirements

- [OpenCode](https://opencode.ai) with plugin support
- [Bun](https://bun.sh) runtime (or Node.js 18.17+)
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) agents (optional but recommended — provides `explore`/`quick`/`deep` categories)

## Configuration

Copy `memory.config.example.json` to `memory.config.json` and edit as needed:

```bash
cp memory.config.example.json memory.config.json
```

```jsonc
{
  "enabled": true,
  "features": {
    "recall": {
      "enabled": true,
      "agent": "explore",        // Subagent type for LLM rerank
      "background": true,        // Async prefetch (non-blocking)
      "llm_rerank": true,        // Set false for rule-filter-only mode
      "max_candidates": 20,      // Stage 1 survivors
      "max_results": 5,          // Final selected count
      "min_query_length": 5      // Skip short queries like "ok"
    },
    "extraction": {
      "enabled": true,
      "category": "quick",       // Subagent category for extraction
      "min_tokens_to_init": 10000,
      "min_tokens_between_update": 5000,
      "max_section_length": 2000,
      "max_total_tokens": 12000
    },
    "dream": {
      "enabled": true,
      "category": "deep",        // Subagent category for dream
      "min_hours_since_last": 24,
      "min_sessions_since_last": 5,
      "min_messages_since_last": 10,
      "lock_stale_timeout_ms": 3600000
    },
    "staleness": {
      "warn_after_days": 1
    },
    "scope": {
      "user_scope_enabled": true,
      "project_overrides_user": true
    }
  },
  "models": {
    "recall": null,       // null = use agent default; or set e.g. "opencode/north-mini-code-free"
    "extraction": null,
    "dream": null
  },
  "memoryPressure": {
    "maxFiles": 500,         // File count threshold
    "maxIndexSize": 25000,   // MEMORY.md byte limit
    "maxTotalSize": 5242880, // Total memory dir size (estimated)
    "elevatedRatio": 0.7,    // ≥70% → elevated
    "criticalRatio": 0.9     // ≥90% → critical
  },
  "telemetry": {
    "enabled": true,         // Set false to disable all event logging
    "maxAgeDays": 7,         // Auto-cleanup events older than 7 days
    "maxEventsPerFile": 1000
  },
  "agents": {
    "recall":   { "agent": "explore", "model": null },
    "extraction": { "category": "quick", "model": null },
    "dream":    { "category": "deep", "model": null }
  }
}
```

### Memory Storage Locations

| Scope | Path |
|-------|------|
| Project | `~/.config/opencode/memory/projects/<sanitized-git-root>/` |
| User | `~/.config/opencode/memory/user/` |

Each memory file is a Markdown file with YAML frontmatter:

```markdown
---
name: User Role
description: User is a senior backend engineer
type: user
scope: user
confidence: explicit
schema_version: 1
---

Memory body content...
```

## Testing

```bash
# Run all unit + integration tests (139 tests, 18 files)
bun test test/chain.test.ts test/config-pressure.test.ts test/cursor.test.ts \
     test/entry-delete.test.ts test/health-pressure.test.ts test/integration.test.ts \
     test/lock-recall.test.ts test/lock.test.ts test/paths.test.ts test/prompt.test.ts \
     test/resolve-agent.test.ts test/scan.test.ts test/state-pressure.test.ts \
     test/staleness.test.ts test/telemetry.test.ts test/tools.test.ts \
     test/transient-filter.test.ts test/round10-integration.test.ts

# Run individual suites
bun test test/integration.test.ts              # Dream + Extraction + Plugin (12 tests)
bun test test/round10-integration.test.ts      # Cursor + Pressure + RecallHandle (14 tests)
bun test test/cursor.test.ts                   # Cursor read/write (6 tests)
bun test test/telemetry.test.ts                # Telemetry logging (9 tests)
bun test test/health-pressure.test.ts          # Pressure detection (6 tests)
```

139 tests total across 18 files, all passing.

## Design Principles

1. **Pipeline over replication** — Not a Claude Code clone; a pipeline-first design adapted to OpenCode's architecture
2. **Free-model first** — Every LLM stage degrades gracefully; rule filter works with zero model calls
3. **Incremental over reprocess** — Cursor tracks message offset; only new messages are sent to the LLM on re-extraction
4. **Pressure-aware scheduling** — Dream consolidation responds to memory pressure (critical triggers immediately, elevated halves time gate)
5. **Telemetry never blocks** — All event logging is fire-and-forget (`void logEvent`); failures are silent
6. **Loose coupling** — `type` ≠ `scope`; type is semantic, scope is lifecycle, overridable per-memory
7. **Cooperative, not competitive** — Main agent writes memories proactively; extraction/dream are safety nets
8. **Defense in depth** — Path traversal protection at both tool layer and store layer

## Memory System Conceptual Q&A

> A user-perspective summary of how the memory system works, complementing the technical documentation above.

### What the Memory System Is

A file-based persistence mechanism across sessions, so the agent carries forward into each new conversation:

- Who you are (identity, role, preferences)
- How you like to collaborate (corrected mistakes, validated approaches)
- Project context (motivation, progress, who is doing what)
- Where external resources live (Linear, Slack, etc. pointers)

Two scopes:

- **User-level** (cross-project, shared): identity and preferences
- **Project-level** (per-project): project context; overrides user-level on conflict

### Design Tensions

The system balances four tensions:

1. **Persistence vs Freshness** — A memory is a point-in-time snapshot ("true when written"); verify before recommending (does the file still exist? the function?), update or delete when stale
2. **Completeness vs Relevance** — `MEMORY.md` holds only index pointers (always loaded, <200 lines); full content is read on demand, preventing context bloat
3. **Automatic vs Controlled** — Semi-automatic: agent-driven primary + fallback auto-extraction; rejects forced auto-recording (avoids noise and loss of control)
4. **Derivable vs Non-derivable** — Only store what can't be derived from current state; code patterns, git history, AGENTS.md content, and debug fixes are never stored

Additional principles:

- **Type classification matches lifecycle**: `user` (stable), `feedback` (applies every turn; record both corrections AND confirmations), `project` (volatile), `reference` (navigation pointers)
- **Memory ≠ Plan ≠ Tasks**: Plan aligns approach within a conversation, Tasks track progress within a conversation, Memory persists across conversations
- **Instruction priority**: User > Skills > System prompt; memory is a tool, not an authority

### When It Writes

Two trigger modes:

1. **Explicit** — You say "remember…", "forget…", "always do this"; the agent writes or deletes immediately
2. **Inferred** — The agent proactively detects signals:
   - You reveal role/preferences/knowledge → `user`
   - You correct an approach ("no, not that") or confirm a non-obvious one ("yes, exactly") → `feedback`
   - You mention project who/what/why/when → `project` (relative dates converted to absolute)
   - You reference external systems → `reference`

Key: `feedback` records confirmations too — recording only corrections makes the agent overly cautious and drifts away from validated methods.

### Source Transparency

Agent statements about the memory system fall into three reliability layers:

- **Mechanism layer** (how it works, rules): from system prompt, reliable
- **Index layer** (what's stored): from `MEMORY.md` summary; full file content needs separate read to verify
- **Inference layer** (why it's designed this way): agent's rationalization based on mechanism; may have bias

## License

MIT

## Acknowledgments

- [Claude Code](https://claude.ai) — Original memory pipeline design inspiration
- [OpenCode](https://opencode.ai) — Plugin architecture and event-driven hooks
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) — Agent category system
