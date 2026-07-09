# opencode-memory

English | [简体中文](README-zh.md)

Pipeline-centered, model-agnostic long-term memory system for [OpenCode](https://opencode.ai).

Inspired by Claude Code's memory pipeline, rebuilt for OpenCode's event-driven plugin architecture. Free-model first: every LLM call point is independently configurable with graceful degradation.

## Features

- **KAIROS Mode** — Append-only daily logs during active sessions (zero LLM cost), batch extraction on `session.idle`
- **Two-Stage Recall** — Rule filter (free, zero model calls) + LLM rerank (one lightweight call on survivors only)
- **Dream Consolidation** — 4-phase pipeline: Orient → Gather → Consolidate → Prune, runs periodically with 3-gate scheduling
- **Cross-Project Scope** — User-level memories (global preferences) + project-level memories (per-repo context), with priority override
- **6 Custom Tools** — `memory_save`, `memory_list`, `memory_search`, `memory_read`, `memory_delete`, `memory_append`
- **Staleness Awareness** — Memories older than N days get point-in-time caveats injected into context
- **Model-Agnostic** — Free-model defaults (`explore`/`quick`/`deep` categories), every stage independently configurable

## Architecture

```
src/
├── index.ts        Plugin entry — wires hooks (system.transform, chat.message, event, tool)
├── config.ts       Configuration, type taxonomy (user/feedback/project/reference), scope resolver
├── store.ts        Storage abstraction (FileSystemStore), frontmatter parser
├── paths.ts        Path resolution (project + user memory dirs, git root detection)
├── prompt.ts       System prompt builder (instructions + MEMORY.md index injection)
├── recall.ts       Two-stage recall: rule filter → LLM rerank, multi-scope support
├── extraction.ts   KAIROS session extraction on session.idle
├── dream.ts        Dream consolidation: 4-phase pipeline + 3-gate scheduling
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
chat.message hook ──► Recall (async, non-blocking)
    │                     │
    │              Stage 1: Rule filter (free)
    │              Stage 2: LLM rerank (one call)
    │                     │
    ▼                     ▼
system.transform hook ──► Inject MEMORY.md index + recalled memories
    │
    ▼
Agent runs (with memory context)
    │
    ▼
session.idle event ──► Extraction (batch, KAIROS)
                    └──► Dream consolidation (if gates pass)
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

Edit `memory.config.json` to tune models, thresholds, and features:

```jsonc
{
  "enabled": true,
  "features": {
    "recall": {
      "enabled": true,           // Enable/disable recall pipeline
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
      "min_tokens_between_update": 5000
    },
    "dream": {
      "enabled": true,
      "category": "deep",        // Subagent category for dream
      "min_hours_since_last": 24,
      "min_sessions_since_last": 5
    },
    "scope": {
      "user_scope_enabled": true,       // Cross-project user memory
      "project_overrides_user": true     // Project wins on conflict
    }
  },
  "models": {
    "recall": null,     // null = use agent default; or set e.g. "opencode/north-mini-code-free"
    "extraction": null,
    "dream": null
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
# Run all verification tests
bun run test/verify-all-fixes.ts   # Round 1 (22 tests)
bun run test/verify-round2.ts       # Round 2 (24 tests)

# Run integration tests
bun run test/integration.test.ts
bun run test/scope-integration.ts
```

46 tests total, all passing.

## Design Principles

1. **Pipeline over replication** — Not a Claude Code clone; a pipeline-first design adapted to OpenCode's architecture
2. **Free-model first** — Every LLM stage degrades gracefully; rule filter works with zero model calls
3. **Loose coupling** — `type` ≠ `scope`; type is semantic, scope is lifecycle, overridable per-memory
4. **Cooperative, not competitive** — Main agent writes memories proactively; extraction/dream are safety nets
5. **Defense in depth** — Path traversal protection at both tool layer and store layer

## License

MIT

## Acknowledgments

- [Claude Code](https://claude.ai) — Original memory pipeline design inspiration
- [OpenCode](https://opencode.ai) — Plugin architecture and event-driven hooks
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) — Agent category system
