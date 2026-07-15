# opencode-memory

English | [简体中文](README-zh.md)

Pipeline-centered, model-agnostic long-term memory system for [OpenCode](https://opencode.ai).

Inspired by Claude Code's memory pipeline and Qwen Code's fact-layer architecture, rebuilt for OpenCode's event-driven plugin architecture. Free-model first: every LLM call point is independently configurable with graceful degradation.

## Features

### Core Pipeline
- **KAIROS Mode** — Append-only daily logs during active sessions (zero LLM cost), batch extraction on `session.idle`
- **Incremental Extraction** — Cursor-based message offset tracking; only new messages since the last extraction run are sent to the LLM (reduces cost on long sessions)
- **Two-Stage Recall** — Rule filter (free, zero model calls) + LLM rerank (one lightweight call on survivors only)
- **RecallHandle** — Async recall fires on `chat.message`, settles in background, injects on next `system.transform` turn — no blocking, no missed results
- **Active Tool Filter** — Transient tool-debug memories (e.g. "npm install failed") are filtered from recall when the tool is active; durable markers ("workaround", "known issue") survive
- **Memory Pressure** — 3-level detection (normal/elevated/critical) based on file count, index size, and total size; critical pressure bypasses dream time gate, elevated halves it
- **Dream Consolidation** — 4-phase pipeline: Prepare (orient+gather combined) → Consolidate → Prune, runs periodically with 3-gate scheduling + pressure-aware triggering — 3 LLM calls instead of 4
- **Entry-Level Deletion** — `memory_delete` supports `entryId` parameter for removing individual entries from multi-entry memory files, not just whole files
- **Telemetry** — Structured JSONL event logging (`logEvent`/`queryEvents`/`cleanupOldEvents`) for extraction, recall, and dream lifecycle — never blocks the pipeline
- **Cross-Project Scope** — User-level memories (global preferences) + project-level memories (per-repo context), with priority override
- **6 Custom Tools** — `memory_save`, `memory_list`, `memory_search`, `memory_read`, `memory_delete` (with entry-level), `memory_append`
- **Staleness Awareness** — Memories older than N days get point-in-time caveats injected into context
- **Model-Agnostic** — Free-model defaults (`explore`/`quick`/`deep` categories), every stage independently configurable with `resolveAgentConfig` safety check

### Quality & Security (v0.2+)
- **Extraction Validator** — 4-layer quality gate (schema → section → placeholder → length) before write; prevents garbage content from polluting the memory store
- **Related Memory Filtering** — `scoreMemory()` pre-filters existing memories to top-10 by keyword relevance; reduces extraction prompt token waste by 60-80%
- **Semantic Description** — LLM outputs `name`/`description` frontmatter; session memories become searchable by recall's keyword matching
- **Semantic Fingerprint** — TF-IDF keyword extraction + Jaccard similarity > 0.8 → merge; catches semantic overlap even when exact text differs (not SHA256)
- **Recall Usage Tracking** — `store.touch()` on recall hits; 180-day prune rule for non-explicit memories; **explicit memories are never auto-deleted**
- **Message Cache** — `chat.message` hook writes to `fact/messages/*.jsonl`; decouples extraction from SDK API, enables offline replay
- **MemoryPathGuard** — Symlink protection, `realpath()` check, path escape prevention; security layer for the auto-write system
- **Explicit Feedback Fast Track** — Detects explicit signals ("记住", "always use", "never use") and saves directly with `confidence: explicit, source: agent_save`; bypasses Dream
- **Typed Memory Candidate** — Extraction produces `semantic/candidates/` with confidence levels; explicit/observed auto-promote, inferred/derived go through Dream review
- **Extract Cursor Enhancement** — Reads from local message cache first, falls back to SDK API; true incremental processing

## Architecture

```
src/
├── index.ts              Plugin entry — wires hooks (system.transform, chat.message, event, tool)
├── config.ts             Configuration, type taxonomy, scope resolver, resolveAgentConfig, DreamMode
├── store.ts              Storage abstraction (FileSystemStore), frontmatter parser, touch(), pathguard integration
├── paths.ts              Path resolution (project + user dirs, git root, cursor + message cache paths)
├── prompt.ts             System prompt builder (instructions + MEMORY.md index injection)
├── recall.ts             Two-stage recall: rule filter → LLM rerank, RecallHandle, scoreMemory (exported), touch on hit
├── extraction.ts         KAIROS extraction: validator + fingerprint + semantic description + explicit feedback + candidates
├── extraction-validator.ts  4-layer quality gate (schema/section/placeholder/length) — pure, no I/O
├── fingerprint.ts        TF-IDF keyword extraction + Jaccard similarity for semantic dedup — pure
├── message-cache.ts      Append-only JSONL message cache (chat.message → fact/messages/*.jsonl)
├── explicit-feedback.ts  Detects explicit signals ("记住"/"always use") — direct save, bypasses Dream
├── candidate.ts          Typed memory candidates with confidence-based Dream routing
├── dream.ts              Dream consolidation: prepareDreamContext (orient+gather) → consolidate → prune + 180-day recall prune
├── pathguard.ts          Symlink protection, realpath check, path escape prevention
├── cursor.ts             Incremental extraction tracking (readCursor/writeCursor)
├── health.ts             Memory pressure detection (3-level), health score, DreamMode-typed windows
├── state.ts              Pipeline state (state.json), DreamMode union type, mergeState validation
├── telemetry.ts          Structured JSONL event logging (logEvent/queryEvents/cleanupOldEvents)
├── scan.ts               Directory scanning + manifest/selection formatting
├── staleness.ts          Age computation + freshness caveats (pure, no I/O)
├── promotion.ts          Dream change validation + confidence-based conflict resolution
├── capture.ts            Fact Layer: immutable session record with session-specific $id
├── adapter.ts            Runtime adapter (SDK → clean interface, git snapshot, health check)
├── migration.ts          Cross-version data migration
├── log.ts                File logger (avoids stdout pollution, Windows CJK safe)
├── lock.ts               File-based mutual exclusion (PID + stale timeout)
└── tools.ts              6 custom tool definitions for the main agent
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
# Run all unit + integration tests (216 tests, 27 files)
bun test test/chain.test.ts test/candidate.test.ts test/config-pressure.test.ts \
     test/cursor.test.ts test/dream-prepare.test.ts test/entry-delete.test.ts \
     test/explicit-feedback.test.ts test/extraction-validator.test.ts test/fingerprint.test.ts \
     test/health-pressure.test.ts test/integration.test.ts test/lock-recall.test.ts \
     test/lock.test.ts test/message-cache.test.ts test/paths.test.ts test/pathguard.test.ts \
     test/promotion.test.ts test/prompt.test.ts test/recall-tracking.test.ts \
     test/resolve-agent.test.ts test/round10-integration.test.ts test/scan.test.ts \
     test/state-pressure.test.ts test/staleness.test.ts test/telemetry.test.ts \
     test/tools.test.ts test/transient-filter.test.ts

# Run individual suites
bun test test/extraction-validator.test.ts   # 4-layer quality gate (10 tests)
bun test test/fingerprint.test.ts            # TF-IDF Jaccard dedup (11 tests)
bun test test/recall-tracking.test.ts       # touch() + tracking (4 tests)
bun test test/message-cache.test.ts          # JSONL message cache (5 tests)
bun test test/pathguard.test.ts             # Symlink/path security (6 tests)
bun test test/explicit-feedback.test.ts      # Explicit signal detection (5 tests)
bun test test/dream-prepare.test.ts          # Combined orient+gather (5 tests)
bun test test/candidate.test.ts              # Typed candidate detection (6 tests)
bun test test/promotion.test.ts             # Confidence override rules (25 tests)
bun test test/integration.test.ts            # Dream + Extraction + Plugin (12 tests)
bun test test/round10-integration.test.ts    # Cursor + Pressure + RecallHandle (14 tests)
```

216 tests total across 27 files, 213 passing (3 SDK timeout tests require live OpenCode instance).

## Design Principles

1. **Pipeline over replication** — Not a Claude Code clone; a pipeline-first design adapted to OpenCode's architecture
2. **Free-model first** — Every LLM stage degrades gracefully; rule filter works with zero model calls
3. **Incremental over reprocess** — Cursor tracks message offset; only new messages are sent to the LLM on re-extraction
4. **Pressure-aware scheduling** — Dream consolidation responds to memory pressure (critical triggers immediately, elevated halves time gate)
5. **Telemetry never blocks** — All event logging is fire-and-forget (`void logEvent`); failures are silent
6. **Loose coupling** — `type` ≠ `scope`; type is semantic, scope is lifecycle, overridable per-memory
7. **Cooperative, not competitive** — Main agent writes memories proactively; extraction/dream are safety nets
8. **Defense in depth** — PathGuard (symlink/realpath/escape) + store-layer traversal check = two-layer security
9. **Quality gate before write** — Extraction output is validated (4-layer check) before entering the memory store
10. **Semantic dedup over hash** — TF-IDF Jaccard similarity catches semantic overlap even when exact text differs
11. **Confidence-based routing** — Explicit/observed memories auto-promote; inferred/derived go through Dream review
12. **Recall-driven governance** — 180-day prune rule for unrecalled non-explicit memories; explicit memories are permanent

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
- [Qwen Code](https://github.com/QwenLM/qwen-code) — Fact layer architecture, recall-selection concept, symlink protection

## Changelog

### v0.2.0 — Extraction Quality & Security (2026-07-15)

**Quality Gate (P0)**
- Extraction Validator — 4-layer quality gate (schema/section/placeholder/length) before write
- Related Memory Filtering — `scoreMemory()` pre-filters to top-10, token -60~80%

**Quality Infrastructure (P1)**
- Semantic Description — LLM outputs `name`/`description` frontmatter for recall matching
- Semantic Fingerprint — TF-IDF Jaccard > 0.8 dedup, not SHA256
- Recall Usage Tracking — `store.touch()` + 180-day prune (never delete explicit)
- Message Cache — `chat.message` → `fact/messages/*.jsonl`, SDK decoupling

**Intelligence & Security (P2)**
- MemoryPathGuard — symlink protection, realpath check, path escape prevention
- Explicit Feedback Fast Track — direct save for "记住"/"always use" signals
- Dream Prepare Merge — 4-phase logic, 3 LLM calls (orient+gather combined)
- Typed Memory Candidate — confidence-based routing (explicit/observed auto-promote)
- Extract Cursor Enhancement — reads from local cache, SDK fallback

**Earlier fixes**
- Confidence level mismatch — `uncertain: 0` added to `promotion.ts` priority map
- `$id` uniqueness — session-specific URI in `capture.ts` and `extraction.ts`
- `DreamMode` union type — type safety for `state.ts` and `health.ts`

**Test growth:** 139 → 216 tests (+77), 27 files, 0 regressions

### v0.1.0 — Initial Release

- KAIROS extraction, two-stage recall, Dream consolidation, telemetry, memory pressure
- 139 tests across 18 files
