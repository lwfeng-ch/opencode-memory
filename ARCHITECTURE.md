# Architecture Documentation

> **Version**: 0.3.0 | **Last Updated**: 2026-07-15 | **Tests**: 258 pass / 34 files

## Table of Contents

1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Data Flow](#3-data-flow)
4. [Module Reference](#4-module-reference)
5. [Directory Layout](#5-directory-layout)
6. [Configuration](#6-configuration)
7. [Memory Types & Scope](#7-memory-types--scope)
8. [Pipeline Stages](#8-pipeline-stages)
9. [Optimization Features (Rounds 1-10)](#9-optimization-features-rounds-1-10)
10. [Telemetry & Observability](#10-telemetry--observability)
11. [Audit & Benchmark (v0.3+)](#11-audit--benchmark-v03)
12. [Testing](#12-testing)
13. [Design Principles](#13-design-principles)
14. [Known Limitations](#14-known-limitations)

---

## 1. Overview

**opencode-memory** is a pipeline-centered, model-agnostic long-term memory system for [OpenCode](https://opencode.ai). It persists information across sessions — user identity, feedback, project context, and external references — so the agent carries forward knowledge into each new conversation.

### Inspirations

- **Claude Code** — Memory pipeline design: KAIROS append-only logs, two-stage recall, dream consolidation
- **Qwen Code** — Fact Layer architecture: immutable session records, cursor-based incremental extraction, structured telemetry

### Key Characteristics

| Property | Implementation |
|----------|---------------|
| LLM cost | Free-model first; every LLM stage degrades gracefully to zero-cost mode |
| Persistence | File-based (Markdown + YAML frontmatter); no database |
| Architecture | 6-layer hybrid pipeline; event-driven hooks |
| Concurrency | Fire-and-forget async; per-session isolation; file-based locks |
| Observability | state.json (pipeline health) + JSONL telemetry events |

---

## 2. System Architecture

### 6-Layer Hybrid Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                     OpenCode Plugin Runtime                         │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ Adapter     │  │ Fact Layer   │  │ Processing Layer          │  │
│  │ (adapter.ts)│  │ (capture.ts)│  │ (extraction.ts + cursor)  │  │
│  │ SDK wrapper │  │ Zero LLM    │  │ LLM transform fact→know.  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                │                         │                │
│  ┌──────┴──────────────┴─────────────────────────┴─────────────┐  │
│  │                    Semantic Layer                               │  │
│  │  (store.ts, scan.ts, staleness.ts, prompt.ts)                  │  │
│  │  File-based storage, frontmatter, index, prompt injection       │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────┴─────────────────────────────────────┐  │
│  │                    Trigger Layer                                │  │
│  │  (dream.ts, lock.ts, health.ts)                                │  │
│  │  Periodic consolidation, pressure-aware scheduling              │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────┴─────────────────────────────────────┐  │
│  │                    Observability Layer                           │  │
│  │  (state.ts, telemetry.ts, log.ts, health.ts)                    │  │
│  │  Pipeline state, JSONL events, health score, file logging       │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────┴─────────────────────────────────────┐  │
│  │              Evaluation Layer (v0.3+)                            │  │
│  │  (evaluation/: fingerprint, scoring, comparison, metrics, types)│  │
│  │  Shared evaluation primitives — no circular deps               │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────┴─────────────────────────────────────┐  │
│  │              Audit & Benchmark (v0.3+)                           │  │
│  │  (audit/: 4 analyzers + MemoryAuditService)                     │  │
│  │  (benchmark/: runner, executor, suites, metrics, reporter)      │  │
│  │  (scripts/: audit-cli, benchmark-cli)                           │  │
│  │  Read-only health scan + pipeline logic evaluation              │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Hook Integration

The plugin registers 4 hooks via the OpenCode plugin API:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `experimental.chat.system.transform` | Every system prompt build | Inject MEMORY.md index + recalled memories |
| `chat.message` | Every user message | Fire async recall (RecallHandle) + track message count |
| `event` | OpenCode events (e.g. `session.idle`) | Capture → Extraction → Dream pipeline |
| `tool` | Plugin load | Register 9 custom tools for the agent |

---

## 3. Data Flow

### Active Session (per user message)

```
User sends message
       │
       ▼
chat.message hook
       │
       ├─► Track: sessionMessageCount++, sessionFirstMessage (if first)
       ├─► Extract user query from message
       ├─► Get recentTools from sessionRecentTools map
       │
       └─► Fire async recall (RecallHandle):
              │
              ├─► Stage 1: Rule filter (free)
              │     • scanMemoryFiles → scoreMemory (keyword + type + freshness)
              │     • Filter: isTransientToolMemory (skip "npm install failed" when npm active)
              │     • Sort by score, take top maxCandidates
              │
              ├─► Stage 2: LLM rerank (one call, optional)
              │     • Skipped when: llmRerankDisabled, critical pressure, no candidates
              │     • LLM selects top maxResults from candidates
              │     • Fallback to Stage 1 result on LLM failure
              │
              └─► RecallHandle.settledAt = Date.now()
                     (consumed on next system.transform)

system.transform hook
       │
       ├─► Build memory prompt (MEMORY.md index + instructions)
       ├─► Check pendingRecallMap[sessionID]:
       │     if settled && !consumed → inject recalled memories, mark consumed
       ├─► Check sessionRecallCache[sessionID]:
       │     if exists → inject cached recalled memories
       └─► output.system.push(prompt + memories)

Agent runs with memory context
```

### Session Idle (post-session processing)

```
session.idle event
       │
       ├─► Phase 1: Capture (mandatory, zero LLM)
       │     captureSession() writes fact/sessions/YYYY/MM/session_xxx.json
       │     • Git snapshot, runtime info, message/tool counts
       │     • Immutable after write — LLM failure doesn't lose data
       │
       ├─► Phase 2: Extraction (optional, LLM, cursor-incremental)
       │     extractSessionMemory():
       │     • Read fact record (Step 1)
       │     • Read cursor offset (Step 2.5) — sessionId must match
       │     • Fetch messages, slice [cursorOffset:] (Step 3)
       │     • If no new messages → update cursor timestamp, return success
       │     • LLM transform: fact + new messages → semantic session memory
       │     • Write to semantic/sessions/session_xxx.md
       │     • Update cursor offset (Step 10): cursorOffset + messages.length
       │     • Log telemetry: extraction.started, extraction.completed
       │
       └─► Phase 3: Dream (optional, LLM, gated + pressure-aware)
             shouldRunDream():
             • Gate 0: Message threshold (if configured)
             • Gate 1: Time (lock file mtime vs minHoursSinceLast)
             • Gate 2: Memory pressure (checkMemoryPressure → 3-level)
               - critical → bypass time gate, trigger directly
               - elevated → halve time requirement
               - normal → respect time gate
             • Gate 3: Session count (files modified since last run)
             • Gate 4: Lock (file-based mutual exclusion)
             
             runDreamConsolidation():
             • Phase Orient: LLM analyzes topics, gaps, stale files
             • Phase Gather: LLM collects logs, drifted memories, new info
             • Phase Consolidate: LLM proposes writes/deletes
             • Phase Prune: promoteStaging → validate + apply changes
             • Log telemetry: dream.started, dream.completed
             • Update state.json: last_run_at, total_runs
```

---

## 4. Module Reference

### Core Modules (`src/`)

| File | Lines | Role | LLM? |
|------|-------|------|------|
| `index.ts` | 448 | Plugin entry — wires hooks, manages maps (pendingRecall, sessionRecentTools, etc.) | No |
| `config.ts` | ~650 | Configuration loading, type taxonomy, scope resolver, resolveAgentConfig | No |
| `store.ts` | ~280 | FileSystemStore, frontmatter parser, parseEntries/deleteEntry | No |
| `paths.ts` | 136 | Path resolution (project/user dirs, git root, cursor paths, fact paths) | No |
| `prompt.ts` | ~780 | System prompt builder (instructions + MEMORY.md index + daily log) | No |
| `recall.ts` | ~720 | Two-stage recall, RecallHandle, isTransientToolMemory, pressure cache | Optional |
| `extraction.ts` | ~930 | KAIROS session extraction, cursor-based incremental processing | Yes |
| `dream.ts` | ~770 | Dream consolidation: 4-phase pipeline + 3-gate + pressure-aware | Yes |
| `cursor.ts` | 58 | Incremental extraction tracking (readCursor/writeCursor) | No |
| `health.ts` | 359 | Memory pressure (3-level), health score, status report | No |
| `telemetry.ts` | 134 | Structured JSONL event logging | No |
| `scan.ts` | 160 | Directory scanning + manifest/selection formatting | No |
| `staleness.ts` | 76 | Age computation + freshness caveats (pure) | No |
| `lock.ts` | 138 | File-based mutual exclusion (PID + stale timeout) | No |
| `tools.ts` | ~570 | 9 custom tool definitions for the agent | No |
| `adapter.ts` | ~430 | Runtime adapter — SDK wrapper, capability detection, self-check | No |
| `capture.ts` | ~220 | Fact Layer — deterministic session capture (zero LLM) | No |
| `state.ts` | 236 | Pipeline state (state.json) — load/save/update, event tracking | No |
| `log.ts` | 133 | File-based logger (avoids terminal pollution) | No |
| `promotion.ts` | ~380 | Staging → promotion: conflict resolution, confidence override | No |
| `migration.ts` | ~170 | v1 → v2 schema migration | No |

### Module Dependencies

```
index.ts
  ├── config.ts (loadConfig, resolveAgentConfig)
  ├── store.ts (createStore)
  ├── paths.ts (getMemoryDir, getUserMemoryDir)
  ├── prompt.ts (buildMemoryPrompt, buildScopedMemoryPrompt)
  ├── recall.ts (recallMemories, recallMemoriesMultiScope, RecallHandle)
  │     └── evaluation/scoring.ts (scoreMemory — extracted, re-exported)
  ├── extraction.ts (extractSessionMemory)
  │     ├── evaluation/scoring.ts (scoreMemory)
  │     ├── evaluation/fingerprint.ts (shouldMerge)
  │     ├── cursor.ts (readCursor, writeCursor)
  │     ├── telemetry.ts (logEvent)
  │     └── config.ts (resolveAgentConfig)
  ├── dream.ts (shouldRunDream, runDreamConsolidation)
  │     ├── health.ts (checkMemoryPressure)
  │     ├── telemetry.ts (logEvent)
  │     ├── promotion.ts (promoteStaging)
  │     └── config.ts (resolveAgentConfig)
  ├── capture.ts (captureSession)
  ├── adapter.ts (createRuntimeAdapter)
  ├── tools.ts (defineMemoryTools)
  ├── scan.ts (scanMemoryFiles, formatMemoriesByScope)
  ├── state.ts (updateState, recordEvent)
  ├── log.ts (initLogger, error)
  └── migration.ts (runMigrationIfNeeded)

evaluation/ (shared primitives — v0.3+)
  ├── types.ts          EvaluationResult, EvaluationContext
  ├── metrics.ts        precision, recallAtK, f1, reductionRate (pure math)
  ├── fingerprint.ts    TF-IDF + Jaccard (migrated from src/)
  ├── scoring.ts        scoreMemory (extracted from recall.ts)
  ├── comparison.ts      SemanticComparator + DefaultMemoryComparator (3-layer + field-weighted, v0.3.1)
  ├── quality.ts        5 dimension check functions (v0.3.1)
  └── quality-score.ts  MemoryQualityEvaluator + QualityReport (v0.3.1)

audit/ (read-only health scanner — v0.3+)
  ├── index.ts          MemoryAuditService + 4 analyzer registration
  ├── analyzer/
  │   ├── duplicate.ts  → evaluation/fingerprint.ts
  │   ├── conflict.ts   → promotion.ts (canOverride)
  │   ├── quality.ts   → store.ts (parseFrontmatter)
  │   └── staleness.ts  → staleness.ts (memoryAgeDays)
  └── report.ts         JSON/Markdown/Console formatters

benchmark/ (test harness — v0.3+, project root)
  ├── runner.ts         → metrics.ts (getMetricForSuite)
  ├── dataset.ts        loads JSON cases from data/
  ├── executor/mock.ts  strict + adversarial dual mode
  ├── executor/golden.ts  runtime + comparator (v0.3.1)
  ├── suites/           5 suite implementations
  └── reporter.ts       BenchmarkReport generation (intelligence_score + suites, v0.3.1)

scripts/ (CLI — v0.3+)
  ├── audit-cli.ts      → audit/index.ts (createDefaultAuditService)
  ├── benchmark-cli.ts  → benchmark/runner.ts + dataset.ts + executor/mock.ts + executor/golden.ts
  └── quality-cli.ts   → evaluation/quality-score.ts (v0.3.1)
```

---

## 5. Directory Layout

### Source Code

```
opencode-memory/
├── src/
│   ├── index.ts          Plugin entry (448 lines)
│   ├── config.ts         Configuration + resolveAgentConfig (~650 lines)
│   ├── store.ts          FileSystemStore + parseEntries/deleteEntry (~320 lines)
│   ├── paths.ts          Path resolution (136 lines)
│   ├── prompt.ts         System prompt builder (~780 lines)
│   ├── recall.ts         Two-stage recall + RecallHandle + transient filter (~670 lines)
│   ├── extraction.ts     KAIROS extraction + cursor integration (~930 lines)
│   ├── dream.ts          Dream consolidation + pressure-aware (~770 lines)
│   ├── extraction-validator.ts  4-layer quality gate (pure, no I/O)
│   ├── evaluation/       Shared evaluation primitives (v0.3+)
│   │   ├── types.ts      EvaluationResult, EvaluationContext
│   │   ├── metrics.ts    precision/recallAtK/f1/reductionRate (pure math)
│   │   ├── fingerprint.ts  TF-IDF + Jaccard (migrated from src/)
│   │   ├── scoring.ts    scoreMemory extracted from recall.ts
│   │   └── comparison.ts  SemanticComparator<T> + implementations
│   ├── audit/            Read-only memory health scanner (v0.3+)
│   │   ├── index.ts      MemoryAuditService + analyzer registration
│   │   ├── report.ts     AuditReport generation + formatters
│   │   └── analyzer/
│   │       ├── duplicate.ts   TF-IDF Jaccard >0.8 pair detection
│   │       ├── conflict.ts    Version/tech-switch conflict detection
│   │       ├── quality.ts     Frontmatter completeness + content checks
│   │       └── staleness.ts   180-day prune rule, explicit never stale
│   ├── message-cache.ts  Append-only JSONL message cache
│   ├── explicit-feedback.ts  Explicit signal detection ("记住"/"always use")
│   ├── candidate.ts      Typed memory candidates, confidence routing
│   ├── pathguard.ts      Symlink protection, realpath, path escape
│   ├── cursor.ts         Incremental cursor (58 lines)
│   ├── health.ts         Pressure detection + health score (359 lines)
│   ├── telemetry.ts      JSONL event logging (134 lines)
│   ├── scan.ts           Directory scanning + formatting (160 lines)
│   ├── staleness.ts      Age computation (76 lines)
│   ├── lock.ts           File-based mutex (138 lines)
│   ├── tools.ts          6 custom tools (~570 lines)
│   ├── adapter.ts        Runtime adapter (~430 lines)
│   ├── capture.ts        Fact Layer capture (~220 lines)
│   ├── state.ts          Pipeline state (236 lines)
│   ├── log.ts            File logger (133 lines)
│   ├── promotion.ts      Staging → promotion (~430 lines)
│   ├── migration.ts      v1 → v2 migration (~170 lines)
│   └── fingerprint.ts    Re-export shim → evaluation/fingerprint.ts (deprecated)
├── benchmark/            Test harness (v0.3+, not in src/)
│   ├── runner.ts         BenchmarkRunner + executor strategy
│   ├── dataset.ts        JSON case loader
│   ├── metrics.ts        Metric<T> implementations
│   ├── reporter.ts       BenchmarkReport generation
│   ├── executor/mock.ts  strict + adversarial mock
│   ├── suites/           5 suites (dedup, recall, conflict, extraction_pipeline, forgetting)
│   └── data/             11 benchmark cases (5 suites)
├── scripts/              CLI entry points (v0.3+)
│   ├── audit-cli.ts      bun run audit
│   └── benchmark-cli.ts  bun run benchmark
├── test/                 34 test files (258 tests)
├── memory.config.example.json   Configuration template
├── package.json          3 deps: @opencode-ai/plugin, zod, vitest (dev)
└── tsconfig.json         TypeScript config
```

### Runtime Data (per project)

```
~/.config/opencode/memory/
├── user/                          Cross-project user memories
│   ├── MEMORY.md                  Index (always loaded, <200 lines)
│   ├── user_role.md               Example memory file
│   ├── feedback_*.md
│   └── ...
└── projects/
    └── <sanitized-git-root>/      Per-project memories
        ├── MEMORY.md               Project index
        ├── *.md                    Memory files
        ├── state.json              Pipeline state (health, counters)
        ├── .consolidate-lock       Dream mutex (PID + mtime)
        ├── logs/
        │   └── memory.log          File logger output
        ├── fact/
        │   ├── sessions/
        │   │   └── YYYY/MM/session_xxx.json   Immutable fact records
        │   └── cursor/
        │       └── extraction-cursor.json    Incremental extraction cursor
        ├── semantic/
        │   ├── sessions/
        │   │   └── session_xxx.md             Extracted session memories
        │   ├── staging/                       Dream proposed changes
        │   └── conflicts/                     Unresolved conflicts
        └── events/
            └── YYYY-MM-DD.jsonl               Telemetry events
```

---

## 6. Configuration

### File: `memory.config.example.json`

Copy to `memory.config.json` and customize:

```bash
cp memory.config.example.json memory.config.json
```

### Configuration Sections

#### Features

| Section | Key Fields | Default | Purpose |
|---------|-----------|---------|---------|
| `recall` | `agent`, `background`, `llm_rerank`, `max_candidates`, `max_results`, `min_query_length` | `explore`, `true`, `true`, `20`, `5`, `5` | Two-stage recall pipeline |
| `extraction` | `category`, `min_tokens_to_init`, `min_tokens_between_update`, `max_section_length`, `max_total_tokens` | `quick`, `10000`, `5000`, `2000`, `12000` | KAIROS session extraction |
| `dream` | `category`, `min_hours_since_last`, `min_sessions_since_last`, `min_messages_since_last`, `lock_stale_timeout_ms` | `deep`, `24`, `5`, `10`, `3600000` | Dream consolidation |
| `staleness` | `warn_after_days` | `1` | Staleness caveat threshold |
| `scope` | `user_scope_enabled`, `project_overrides_user` | `true`, `true` | Cross-project scope |

#### Models

Override the model for each stage. `null` = use agent/category default.

```json
"models": { "recall": null, "extraction": null, "dream": null }
```

#### memoryPressure (Rounds 5-6)

3-level pressure detection thresholds:

```json
"memoryPressure": {
  "maxFiles": 500,
  "maxIndexSize": 25000,
  "maxTotalSize": 5242880,
  "elevatedRatio": 0.7,
  "criticalRatio": 0.9
}
```

#### telemetry (Round 7)

Structured JSONL event logging:

```json
"telemetry": {
  "enabled": true,
  "maxAgeDays": 7,
  "maxEventsPerFile": 1000
}
```

#### agents (Round 8)

Agent configuration with category-label safety check:

```json
"agents": {
  "recall":     { "agent": "explore", "model": null },
  "extraction": { "category": "quick", "model": null },
  "dream":      { "category": "deep", "model": null }
}
```

`resolveAgentConfig()` ensures category labels (`quick`, `deep`, `explore`) are never passed as agent names to the SDK — a historical HTTP 500 bug source.

#### entrypoint & scan

```json
"entrypoint": { "max_lines": 200, "max_bytes": 25000 }
"scan": { "max_files": 50, "frontmatter_max_lines": 5 }
```

---

## 7. Memory Types & Scope

### Memory Types

| Type | Default Scope | Confidence Default | Lifecycle | Purpose |
|------|--------------|-------------------|-----------|---------|
| `user` | user | explicit | Stable (months) | Identity, role, goals, expertise |
| `feedback` | user | inferred | Every turn | Corrections AND confirmations |
| `project` | project | inferred | Volatile (days) | Ongoing work, decisions, deadlines |
| `reference` | project | inferred | Semi-stable | External system pointers |

### Scope System

Two directories, two scopes:

- **User scope** (`~/.config/opencode/memory/user/`) — shared across ALL projects
- **Project scope** (`~/.config/opencode/memory/projects/<git-root>/`) — isolated per repo

Default routing: `user`/`feedback` → user scope; `project`/`reference` → project scope.

**Priority**: Project memories override user memories when conflicts exist (configurable via `scope.project_overrides_user`).

### Memory File Format

```markdown
---
name: User Role
description: Senior Go engineer who values clean code
type: user
scope: user
confidence: explicit
schema_version: 1
---

Memory body content...
```

---

## 8. Pipeline Stages

### Stage 1: Capture (Fact Layer)

- **Trigger**: `session.idle` event
- **Module**: `capture.ts`
- **LLM**: None (zero cost)
- **Output**: `fact/sessions/YYYY/MM/session_xxx.json` (immutable)
- **Content**: Session ID, timestamps, git snapshot, message/tool counts, runtime info
- **Guarantee**: LLM failure does not lose data — fact record is always written

### Stage 2: Extraction (Processing Layer)

- **Trigger**: `session.idle` (after capture)
- **Module**: `extraction.ts` + `cursor.ts`
- **LLM**: Yes (configurable category, default `quick`)
- **Input**: Fact record + message snapshot (incremental via cursor)
- **Output**: `semantic/sessions/session_xxx.md`
- **Cursor**: Tracks `processedMessageOffset` per session; only new messages are sent to LLM
- **Skip condition**: No new messages since last cursor → update timestamp only, no LLM call

### Stage 3: Recall (Retrieval)

- **Trigger**: `chat.message` hook (every user message)
- **Module**: `recall.ts`
- **LLM**: Optional (Stage 2 rerank, can be disabled)
- **Output**: RecallHandle (async, consumed on next `system.transform`)

#### Stage 1: Rule Filter (free)

- `scanMemoryFiles` → list all memory headers
- `scoreMemory` — keyword match + type bonus + freshness bonus
- `isTransientToolMemory` — filter transient tool-debug memories
- Sort by score, take top `maxCandidates`

#### Stage 2: LLM Rerank (one call)

- Send candidate headers to LLM, ask to select top `maxResults`
- **Skipped when**: `llmRerankDisabled`, critical memory pressure, no candidates
- **Fallback**: On LLM failure, return Stage 1 result

### Stage 4: Dream Consolidation

- **Trigger**: `session.idle` (after extraction, if gates pass)
- **Module**: `dream.ts`
- **LLM**: Yes (configurable category, default `deep`)
- **Gates**: Time + Session + Pressure + Lock (cheapest-first)

#### 4-Phase Pipeline

1. **Orient** — Analyze topics, gaps, stale files, merge candidates
2. **Gather** — Collect daily logs, drifted memories, new information
3. **Consolidate** — Propose memory writes and deletes
4. **Prune** — Validate and apply via `promoteStaging()`

---

## 9. Optimization Features (Rounds 1-10)

Inspired by Qwen Code's architecture, 8 optimization items were implemented across 10 rounds:

### Round 1: Infrastructure

| Feature | Module | Description |
|---------|--------|-------------|
| Cursor path helpers | `paths.ts` | `getFactRootDir`, `getCursorDir`, `getCursorPath` |
| Config sections | `config.ts` | `memoryPressure`, `telemetry`, `agents` |
| State field | `state.ts` | `memory_pressure` in PipelineState |
| Pressure detection | `health.ts` | `checkMemoryPressure` — 3-level (normal/elevated/critical) |

### Round 2: Cursor Module

| Feature | Module | Description |
|---------|--------|-------------|
| readCursor/writeCursor | `cursor.ts` | Atomic write (temp + rename), cross-session reset |

### Round 3: Pressure-Aware Dream

| Feature | Module | Description |
|---------|--------|-------------|
| Multi-level pressure gate | `dream.ts` | critical → bypass time gate; elevated → halve requirement |
| State update | `dream.ts` | Pressure report written to `state.json` |

### Round 4: Incremental Extraction

| Feature | Module | Description |
|---------|--------|-------------|
| Cursor integration | `extraction.ts` | Step 2.5: read cursor; Step 3: slice messages; Step 10: update cursor |
| Skip on no new messages | `extraction.ts` | Update cursor timestamp, return success, no LLM call |
| Message limit | `extraction.ts` | 500 (SDK lacks offset pagination; cursor handles the rest) |

### Round 5: RecallHandle

| Feature | Module | Description |
|---------|--------|-------------|
| RecallHandle type | `recall.ts` | `promise`, `settledAt`, `consumed`, `sessionId` |
| Per-session map | `index.ts` | `pendingRecallMap: Map<string, RecallHandle>` |
| Cross-turn injection | `index.ts` | `system.transform` checks `settledAt && !consumed` |
| No double-inject | `index.ts` | `consumed` flag prevents second injection |

### Round 6: Active Tool Filter

| Feature | Module | Description |
|---------|--------|-------------|
| `isTransientToolMemory` | `recall.ts` | Filter "npm install failed" when npm is active |
| Transient markers | `recall.ts` | `failed`, `error`, `crashed`, `timed out`, `broken`, etc. |
| Durable markers | `recall.ts` | `workaround`, `known issue`, `gotcha`, `requires`, etc. |
| Recent tools tracking | `index.ts` | `sessionRecentTools: Map<string, string[]>` (max 10) |
| Description-only markers | `recall.ts` | Markers checked on description only (not filename — avoids "note" in "npm_notes.md" false positive) |

### Round 7: Entry-Level Deletion

| Feature | Module | Description |
|---------|--------|-------------|
| `parseEntries` | `store.ts` | Parse `<!-- entry:ID -->` markers |
| `deleteEntry` | `store.ts` | Remove specific entry, keep others; delete file if last entry |
| `memory_delete` tool | `tools.ts` | Accepts optional `entryId` parameter |

### Round 8: Telemetry

| Feature | Module | Description |
|---------|--------|-------------|
| `logEvent` | `telemetry.ts` | Append JSONL to `events/YYYY-MM-DD.jsonl` |
| `queryEvents` | `telemetry.ts` | Filter by type, session_id, date; scans last 7 days |
| `cleanupOldEvents` | `telemetry.ts` | Delete event files older than retention period |
| Non-blocking | All | `void logEvent(...)` — never await, never throws |
| Integration | `extraction.ts`, `dream.ts`, `recall.ts` | Events: started, completed, failed, skipped |

### Round 9: ResolveAgentConfig

| Feature | Module | Description |
|---------|--------|-------------|
| `resolveAgentConfig` | `config.ts` | Centralized agent config with category-label safety |
| Category safety | `config.ts` | Never pass `quick`/`deep`/`explore` as agent name to SDK |
| Model fallback | `config.ts` | `agents.model` → `models.*` → undefined |
| All call sites | `recall.ts`, `extraction.ts`, `dream.ts` | 6 call sites updated |

### Round 10: Integration Tests

| Test File | Tests | Scenarios |
|-----------|-------|-----------|
| `round10-integration.test.ts` | 14 | Part D: Cursor + Extraction (4), Part E: Pressure → Dream (4), Part F: RecallHandle (6) |

---

## 10. Telemetry & Observability

### Two Logging Systems

| System | File | Format | Purpose |
|--------|------|--------|---------|
| `log.ts` | `logs/memory.log` | Text (`[ISO] [level] [tag] message`) | Quick ops debugging |
| `telemetry.ts` | `events/YYYY-MM-DD.jsonl` | JSONL (structured) | Precise debugging, audit |

### Telemetry Event Types

```typescript
type TelemetryEventType =
  | "extraction.started" | "extraction.completed" | "extraction.failed" | "extraction.skipped"
  | "dream.started" | "dream.completed" | "dream.failed" | "dream.skipped"
  | "recall.started" | "recall.completed" | "recall.skipped"
  | "memory_pressure.check" | "cursor.updated"
```

### state.json (Pipeline Health)

```json
{
  "version": 1,
  "updated_at": "2026-07-14T12:00:00.000Z",
  "health": { "score": 85, "status": "healthy" },
  "adapter_status": { "session_create": true, "session_messages": true, ... },
  "capture": { "last_capture_at": "...", "total_sessions_captured": 42 },
  "extraction": { "total_successes": 40, "total_failures": 2 },
  "dream": { "last_run_at": "...", "total_runs": 5, "mode": "normal" },
  "recall": { "total_queries": 150, "llm_rerank_used": 100 },
  "memory_pressure": { "level": "normal", "files": 23, "index_size": 4500 }
}
```

### Health Score (0-100)

| Component | Weight | Condition |
|-----------|--------|-----------|
| Adapter working | 30 | `session_create && session_messages` |
| Capture active | 30 | Last capture within mode window |
| Extraction healthy | 20 | `total_failures < total_successes` |
| Dream running | 20 | Last run within mode window |

---

## 11. Audit, Benchmark & Quality (v0.3+)

### Memory Audit

`bun run audit` scans the memory directory for quality, duplicate, conflict, and staleness issues.

**4 Analyzers:**

| Analyzer | Reuses | Detects |
|----------|--------|---------|
| Duplicate | `evaluation/fingerprint.ts` | TF-IDF Jaccard >0.8 pair detection |
| Conflict | `promotion.ts` canOverride | Version number / technology switch conflicts |
| Quality | `store.ts` parseFrontmatter | Missing fields, truncated descriptions, empty bodies |
| Staleness | `staleness.ts` memoryAgeDays | 180-day never-recalled non-explicit memories |

**Constraint:** Audit is READ-ONLY — never modifies or deletes memory files. Repair is v0.4.0.

### Benchmark Framework

`bun run benchmark` runs 5 test suites in Mock mode (no LLM calls):

| Suite | Metric | Mock Cases | Golden Cases |
|-------|--------|------------|--------------|
| Dedup | ReductionRate | 3 | 8 |
| Recall | Recall@K | 3 | 15 |
| Conflict | ConflictResolutionRate | 2 | 7 |
| ExtractionPipeline | ExtractionF1 | 2 | 15 |
| Forgetting | ObsoleteRate | 1 | 5 |

**Mock Executor dual mode:**
- **Strict**: returns expected → tests pipeline logic (validator, store, dedup, recall)
- **Adversarial**: returns garbage → tests defensive capabilities (validator rejection)

**Golden Executor (v0.3.1):**
- Wraps a `RuntimeExecutorFn` + `MemoryComparator`
- Runs golden cases through runtime, compares actual vs expected using semantic comparison
- v0.3.1 uses mock runtime (returns expected) → baseline score = 100
- v0.3.2 will replace with real LLM runtime

**Report:** `reports/benchmark/latest.json` with `intelligence_score`, per-suite scores, and environment metadata

### Memory Quality Score (v0.3.1)

`bun run quality` evaluates 5 quality dimensions:

| Dimension | Weight | Checks |
|-----------|--------|--------|
| Completeness | 20% | name, description, type, scope, confidence present |
| Consistency | 25% | Duplicate detection via shouldMerge (TF-IDF Jaccard >0.8) |
| Freshness | 15% | Age < 180 days + recallCount > 0 (explicit = never stale) |
| Noise | 20% | Placeholder content, generic names, empty/short bodies |
| Retrievability | 20% | recallCount > 0 distribution |

**Semantic Comparator (v0.3.1):**

3-layer text comparison algorithm:
- Layer 1 (20%): Token Jaccard — word-level set overlap (CJK 2-char bigram tokens)
- Layer 2 (50%): TF-IDF keyword Jaccard — weighted keyword set overlap
- Layer 3 (30%): Character bigram Jaccard — fine-grained substring overlap

Field-weighted memory comparison:
- content (50%), description (20%), type (20%), name (10%)

---

## 12. Testing

### Test Suite Overview

```
350 tests | 43 files | 765 assertions | 1 failure (C1 SDK timeout) | ~11s runtime
```

### Test Files

| File | Tests | Category | Covers |
|------|-------|----------|-------|
| `chain.test.ts` | 10 | Unit | Config, store, scan, prompt, staleness |
| `config-pressure.test.ts` | 4 | Unit | memoryPressure/telemetry/agents defaults + deep copy |
| `cursor.test.ts` | 6 | Unit | Cursor path helpers + read/write |
| `entry-delete.test.ts` | 7 | Unit | parseEntries + deleteEntry |
| `health-pressure.test.ts` | 6 | Unit | 3-level pressure detection |
| `integration.test.ts` | 12 | Integration | Dream pipeline, extraction, plugin entry |
| `lock.test.ts` | 6 | Unit | File-based mutex |
| `lock-recall.test.ts` | 12 | Integration | Lock + recall (Stage 1 + Stage 2) |
| `paths.test.ts` | 5 | Unit | Path sanitization + memory dir |
| `prompt.test.ts` | 4 | Unit | truncateEntrypoint |
| `resolve-agent.test.ts` | 9 | Unit | resolveAgentConfig (defaults, custom, safety) |
| `round10-integration.test.ts` | 14 | Integration | Cursor + Pressure + RecallHandle cross-module |
| `scan.test.ts` | 5 | Unit | Manifest + selected memories formatting |
| `staleness.test.ts` | 8 | Unit | Age computation + freshness caveats |
| `state-pressure.test.ts` | 3 | Unit | State defaults + merge |
| `telemetry.test.ts` | 9 | Unit | logEvent + queryEvents + cleanup |
| `tools.test.ts` | 12 | Unit | 6 memory tools (save/list/search/read/delete/append) |
| `transient-filter.test.ts` | 7 | Unit | isTransientToolMemory (transient/durable markers) |

### Running Tests

```bash
# All tests
bun test test/

# Individual suites
bun test test/integration.test.ts          # 12 tests — Dream + Extraction + Plugin
bun test test/round10-integration.test.ts  # 14 tests — Cursor + Pressure + RecallHandle
bun test test/evaluation/comparison.test.ts # 25 tests — Semantic Comparator (v0.3.1)
bun test test/evaluation/quality-score.test.ts # 15 tests — Quality Score (v0.3.1)
bun test test/benchmark/golden.test.ts     # 10 tests — Golden Executor (v0.3.1)
bun test test/integration-v031.test.ts     # 7 tests — v0.3.1 Integration
```

---

## 12. Design Principles

1. **Pipeline over replication** — Not a Claude Code clone; a pipeline-first design adapted to OpenCode's event-driven architecture.

2. **Free-model first** — Every LLM stage degrades gracefully. Rule filter works with zero model calls. LLM rerank can be disabled. Extraction skips on no new messages. Dream skips on gate failure.

3. **Incremental over reprocess** — Cursor tracks message offset; only new messages since last extraction are sent to the LLM. Reduces cost on long sessions.

4. **Pressure-aware scheduling** — Dream consolidation responds to memory pressure. Critical level bypasses time gate entirely. Elevated halves the time requirement. Normal respects all gates.

5. **Telemetry never blocks** — All event logging is fire-and-forget (`void logEvent`). Failures are silent. Telemetry is a debugging tool, not a critical path.

6. **Loose coupling** — `type` ≠ `scope`. Type is semantic (user/feedback/project/reference). Scope is lifecycle (user/project). Overridable per-memory.

7. **Cooperative, not competitive** — Main agent writes memories proactively via tools. Extraction and Dream are safety nets — they don't compete with the agent for control.

8. **Defense in depth** — Path traversal protection at both the tool layer (`validateFilename`) and the store layer (`isMemoryPath`). Filename must match `/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.md$/`.

---

## 13. Known Limitations

1. **`isTransientToolMemory` checks description only** — Does not inspect memory body content. A memory with "failed" in the body but "workaround" in the description will survive the filter. Documented as known limitation.

2. **state.json concurrent write races** — `updateState` is a non-locking read-modify-write. Concurrent updates from different stages may lose the last writer's changes. The telemetry JSONL log is the reliable alternative for audit.

3. **SDK lacks offset pagination** — `session.messages()` doesn't support offset-based pagination. The cursor slices from the fetched array (limited to 500 messages) to achieve incremental processing.

4. **Category labels hardcoded** — `resolveAgentConfig` has a hardcoded list of category labels (`quick`, `deep`, `explore`, `general`). New categories must be added to the safety check manually.

5. **C1 integration test timing** — The "MemoryPlugin loads" test intermittently times out due to adapter self-check timing. Pre-existing, not caused by optimizations.

6. **Pre-existing tsc errors** — Missing `@types/node` causes TypeScript errors in Bun projects. Not caused by optimization changes. Runtime works correctly via Bun's native TS resolution.
