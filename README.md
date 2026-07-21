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

### Observability & Evaluation (v0.3+)
- **Memory Audit** — `bun run audit` scans memory directory for quality issues (truncated descriptions, missing fields, empty bodies), duplicates (TF-IDF Jaccard), conflicts (version/technology-switch detection), and staleness (180-day never-recalled). Read-only — never modifies files.
- **Benchmark Framework** — `bun run benchmark` runs 5 test suites (Dedup, Recall, Conflict, ExtractionPipeline, Forgetting) in Mock mode with strict + adversarial dual-mode executors. Reports JSON/Markdown/Console.
- **Golden Benchmark** (v0.3.1) — `bun run benchmark --mode golden` runs 50 golden dataset cases with semantic comparison scoring. Reports Memory Intelligence Score.
- **Memory Quality Score** (v0.3.1) — `bun run quality` evaluates 5 dimensions (Completeness, Consistency, Freshness, Noise, Retrievability) and outputs overall quality score 0-100.
- **Semantic Comparator** (v0.3.1) — 3-layer text comparison (Token Jaccard 20% + TF-IDF 50% + Bigram 30%) with CJK support + field-weighted memory comparison (content 50%, description 20%, type 20%, name 10%).
- **Hybrid-4Layer Comparator** (v0.3.2) — Embedding layer (35%) added to 3-layer lexical (65%), with automatic fallback to legacy-3layer on embedding failure. `TextComparisonResult` with per-layer breakdown for explainability. `cosineSimilarity` pure function.
- **LLM Provider Abstraction** (v0.3.2) — `CompletionProvider` and `EmbeddingProvider` separated interfaces; `ModelProvider` for text generation. OpenAI + Qwen/DashScope implementations with retry logic and timeout.
- **extractMemories()** (v0.3.2) — Side-effect-isolated core function: builds prompt, calls LLM, parses response, validates candidates, applies fingerprint dedup. Shared by production and benchmark — no store/adapter/IO dependency.
- **Real Extraction Benchmark** (v0.3.2) — `bun run benchmark --mode real --provider qwen --model qwen3-14b --repeat 3` runs real LLM extraction against golden dataset. First real Memory Intelligence Score.
- **Benchmark Cache** (v0.3.2) — `FileBenchmarkCache` with SHA-256 cache key including pipeline config, model params, runtime version, caseId, and repeatIndex (critical — without repeatIndex, repeat=3 hits same cache).
- **Repeat Controller** (v0.3.2) — Suite-level repeat policies: extraction=3 (LLM variance), recall=1 (deterministic), dedup=3, conflict=3, forgetting=1. Total 110 calls for 50 golden cases.
- **Statistics** (v0.3.2) — `computeStats` pure function: mean, stddev, 95% CI (normal approximation; Student-t planned for v0.3.3).
- **LLM Trace Logger** (v0.3.2) — JSONL trace of LLM calls (requestId, model, latency, tokens, cacheHit) for cost/latency analysis.
- **Benchmark Config** (v0.3.2) — Separate `benchmark.config.json` (not in memory.config.json); JSONC comment stripping, env var substitution ($VAR → process.env.VAR).
- **Evaluation Layer** — Independent evaluation primitives (fingerprint, scoring, comparison, metrics, types) shared by Audit, Benchmark, and Quality modules. No circular dependencies.
- **CLI Tools** — `scripts/audit-cli.ts`, `scripts/benchmark-cli.ts`, `scripts/quality-cli.ts` with `--json`, `--scope`, `--suite`, `--mode`, `--provider`, `--model`, `--repeat`, `--no-cache` flags

## Architecture

```
src/
├── index.ts              Plugin entry — wires hooks (system.transform, chat.message, event, tool)
├── config.ts             Configuration, type taxonomy, scope resolver, resolveAgentConfig, DreamMode
├── store.ts              Storage abstraction (FileSystemStore), frontmatter parser, touch(), pathguard integration
├── paths.ts              Path resolution (project + user dirs, git root, cursor + message cache paths)
├── prompt.ts             System prompt builder (instructions + MEMORY.md index injection)
├── recall.ts             Two-stage recall: rule filter → LLM rerank, RecallHandle (scoreMemory re-exported from evaluation)
├── extraction.ts         KAIROS extraction: validator + fingerprint + semantic description + explicit feedback + candidates
├── extraction-validator.ts  4-layer quality gate (schema/section/placeholder/length) — pure, no I/O
├── evaluation/           Shared evaluation primitives (v0.3+)
│   ├── types.ts          EvaluationResult, EvaluationContext
│   ├── metrics.ts        Pure math: precision, recallAtK, f1, reductionRate
│   ├── fingerprint.ts    TF-IDF keyword extraction + Jaccard similarity
│   ├── scoring.ts        scoreMemory extracted from recall.ts
│   ├── comparison.ts     HybridComparator: 4-layer (3-layer + Embedding 35%) with fallback (v0.3.2), TextComparisonResult, cosineSimilarity
│   ├── quality.ts        5 dimension check functions (v0.3.1)
│   └── quality-score.ts  MemoryQualityEvaluator + QualityReport (v0.3.1)
├── llm/                  LLM provider abstraction (v0.3.2)
│   ├── provider.ts       CompletionProvider + EmbeddingProvider + ModelProvider interfaces
│   ├── openai.ts          OpenAI completion + embedding (with retry, timeout)
│   └── qwen.ts            Qwen/DashScope completion + BGE-M3 embedding (with retry, timeout)
├── audit/                Read-only memory health scanner (v0.3+)
│   ├── index.ts          MemoryAuditService — plugin-pattern analyzer orchestration
│   ├── report.ts         AuditReport generation + JSON/Markdown/Console formatters
│   └── analyzer/
│       ├── duplicate.ts  TF-IDF Jaccard >0.8 pair detection (reuses evaluation/fingerprint)
│       ├── conflict.ts   Pair-wise topic similarity + version/tech-switch conflict detection
│       ├── quality.ts    Frontmatter completeness, truncated description, empty body
│       └── staleness.ts  180-day prune rule, explicit memories never stale
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
├── tools.ts              6 custom tool definitions for the main agent
├── fingerprint.ts        Re-export shim → evaluation/fingerprint.ts (deprecated, use new path)
├── lifecycle/            Lifecycle metadata (v0.3.3+)
│   ├── types.ts          MemoryStatus (active|archived), LifecycleMetadata, parseLifecycle, lifecycleScoreMultiplier
│   └── archive-types.ts  ArchiveEntry, buildArchiveLine, parseArchiveLine, MANIFEST_AUTO_GENERATED_HEADER (v0.3.4)
└── index/                Manifest index managers (v0.3.4)
    └── archive-index.ts  ArchiveIndexManager — readArchive/writeArchive/addEntry/removeEntry for ARCHIVE.md

benchmark/                Project-root test harness (not in src/, not packaged)
├── runner.ts             BenchmarkRunner — orchestrates case execution via executor (v0.3.2: BenchmarkResult + stats fields)
├── dataset.ts            Dataset loader (JSON case files from data/)
├── metrics.ts            Metric<T> implementations (Dedup, Recall@K, Conflict, F1, Obsolete)
├── reporter.ts           BenchmarkReport generation → reports/benchmark/latest.json
├── cache.ts             FileBenchmarkCache + NoopCache + computeCacheKey (v0.3.2)
├── repeat.ts            RepeatController + suite-level RepeatPolicy (v0.3.2)
├── stats.ts             computeStats: mean, stddev, CI95 (v0.3.2)
├── trace.ts             LLMTraceLogger: JSONL trace (v0.3.2)
├── config.ts            loadBenchmarkConfig: JSONC + env var substitution (v0.3.2)
├── report-schema.ts     BenchmarkReport v0.3.2 schema + formatters (v0.3.2)
├── executor/mock.ts      Mock executor: strict (returns expected) + adversarial (returns garbage)
├── executor/golden.ts    Golden executor: async runtime + HybridComparator (v0.3.1, updated v0.3.2)
├── executor/extraction.ts ExtractionExecutor: wraps extractMemories() (v0.3.2)
├── suites/               5 suite implementations (dedup, recall, conflict, extraction_pipeline, forgetting)
└── data/                 11 mock + 50 golden benchmark cases (v0.3.1)

scripts/                  CLI entry points (v0.3+)
├── audit-cli.ts          bun run audit [--json] [--scope user|project] [--format markdown]
├── benchmark-cli.ts      bun run benchmark [--mode mock|golden|real] [--provider X] [--model Y] [--repeat N] [--no-cache] (v0.3.2)
├── quality-cli.ts        bun run quality [--json] [--scope user|project|all] (v0.3.1)
├── repair-cli.ts         bun run repair [--scan] [--scope project|user|all] [--list] [--approve-all-low] [--restore X] (v0.3.3)
└── migrate-archive-index.ts  bun run scripts/migrate-archive-index.ts --dry-run|--apply [--scope=project|user|all] [--force] (v0.3.4)
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
# Run all unit + integration tests (350 tests, 43 files)
bun test test/chain.test.ts test/candidate.test.ts test/config-pressure.test.ts \
     test/cursor.test.ts test/dream-prepare.test.ts test/entry-delete.test.ts \
     test/explicit-feedback.test.ts test/extraction-validator.test.ts \
     test/health-pressure.test.ts test/integration.test.ts test/lock-recall.test.ts \
     test/lock.test.ts test/message-cache.test.ts test/paths.test.ts test/pathguard.test.ts \
     test/promotion.test.ts test/prompt.test.ts test/recall-tracking.test.ts \
     test/resolve-agent.test.ts test/round10-integration.test.ts test/scan.test.ts \
     test/state-pressure.test.ts test/staleness.test.ts test/telemetry.test.ts \
     test/tools.test.ts test/transient-filter.test.ts \
     test/evaluation/fingerprint.test.ts test/evaluation/scoring.test.ts \
     test/evaluation/comparison.test.ts test/evaluation/comparison-extra.test.ts \
     test/evaluation/quality-score.test.ts test/evaluation/quality-score-extra.test.ts \
     test/audit/duplicate.test.ts test/audit/conflict.test.ts \
     test/audit/quality.test.ts test/audit/staleness.test.ts \
     test/benchmark/runner.test.ts test/benchmark/metrics.test.ts \
     test/benchmark/golden.test.ts test/benchmark/golden-extra.test.ts \
     test/benchmark/reporter.test.ts test/benchmark/dataset.test.ts \
     test/integration-v031.test.ts

# Run individual suites
bun test test/extraction-validator.test.ts   # 4-layer quality gate (10 tests)
bun test test/evaluation/fingerprint.test.ts  # TF-IDF Jaccard dedup (11 tests)
bun test test/evaluation/scoring.test.ts     # scoreMemory keyword match (8 tests)
bun test test/recall-tracking.test.ts        # touch() + tracking (4 tests)
bun test test/message-cache.test.ts          # JSONL message cache (5 tests)
bun test test/pathguard.test.ts              # Symlink/path security (6 tests)
bun test test/explicit-feedback.test.ts      # Explicit signal detection (5 tests)
bun test test/dream-prepare.test.ts          # Combined orient+gather (5 tests)
bun test test/candidate.test.ts              # Typed candidate detection (6 tests)
bun test test/promotion.test.ts             # Confidence override rules (25 tests)
bun test test/audit/duplicate.test.ts        # Duplicate analyzer (4 tests)
bun test test/audit/conflict.test.ts         # Conflict analyzer (5 tests)
bun test test/audit/quality.test.ts          # Quality analyzer (5 tests)
bun test test/audit/staleness.test.ts        # Staleness analyzer (4 tests)
bun test test/benchmark/runner.test.ts       # Benchmark runner (4 tests)
bun test test/benchmark/metrics.test.ts      # Benchmark metrics (12 tests)
bun test test/integration.test.ts            # Dream + Extraction + Plugin (12 tests)
bun test test/round10-integration.test.ts    # Cursor + Pressure + RecallHandle (14 tests)

# Audit CLI — scan memory health
bun run audit                                # console output
bun run audit --json                         # JSON to stdout
bun run audit --scope user                   # scan user scope only

# Benchmark CLI — run evaluation suites
bun run benchmark                            # all suites, mock mode
bun run benchmark --suite dedup              # specific suite only
bun run benchmark --adversarial              # adversarial mock (tests defense)
bun run benchmark --mode golden              # golden mode with semantic comparison (v0.3.1)
bun run benchmark --mode real --provider qwen --model qwen3-14b --repeat 3  # real LLM (v0.3.2)
bun run benchmark --mode real --no-cache     # real LLM without cache (v0.3.2)

# Quality CLI — memory quality scoring (v0.3.1)
bun run quality                              # scan project memory, console output
bun run quality --json                        # JSON to stdout
bun run quality --scope all                   # scan both user + project scopes

# Repair CLI — memory cleanup (v0.3.3)
bun run repair --scan --include-recent-sessions   # scan project scope, include all session_*.md
bun run repair --scan --scope all                  # scan both project + user scopes
bun run repair --list                               # list pending candidates
bun run repair --approve-all-low                    # approve all low-risk candidates (archive/delete)
bun run repair --restore session_2026-07-01-x.md    # restore archived file to active
bun run repair --clear                              # clear executed/rejected from queue

# Migration CLI — archive index migration (v0.3.4)
bun run scripts/migrate-archive-index.ts --dry-run --scope=project  # preview migration
bun run scripts/migrate-archive-index.ts --apply --scope=project    # execute migration
```

491 tests total across 55 files, 490 passing (1 flaky golden-extra duration test).

> **Note:** As of v0.3.4, the test suite has grown to **669 tests across 67 files** (668 pass + 1 pre-existing C1 SDK timeout that requires a live OpenCode instance). See Changelog below for per-version details.

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
13. **Observability over assumptions** — Audit discovers real problems from actual memory state; confirmed issues become benchmark cases (v0.3+)
14. **Evaluation layer independence** — Shared evaluation primitives (fingerprint, scoring, comparison) serve audit, benchmark, and future modules without circular deps (v0.3+)
15. **CLI ≠ Library** — CLI scripts are thin entry points; runners/services are library code, never the other way around (v0.3+)

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

### v0.3.3 — Memory Repair Foundation (2026-07-20)

**Repair Foundation**
- `RepairService` — `archive()` / `delete()` / `restore()` operating on frontmatter metadata (archive = `status: archived` field, NOT file move)
- `FileCandidateQueue` — file-based JSON queue for repair candidates (add/get/getPending/updateStatus/clearExecuted)
- `AuditLog` — JSONL append-only log of all repair actions with query by type/filename
- `RepairCandidate` — typed candidate with risk assessment (low/medium/high) and `scope` field for multi-scope routing
- `MemoryMigrationScanner` — `LegacyScanner` (legacy/v1/) + `SessionScanner` (session_*.md, configurable threshold)
- `bun run repair` CLI — `--scan` / `--list` / `--approve` / `--approve-all-low` / `--restore` / `--clear` / `--scope project|user|all` / `--include-recent-sessions`

**Lifecycle Metadata**
- `MemoryStatus` (`active` | `archived`) — frontmatter field, defaults to active
- `LifecycleMetadata` interface — status + lastRecalledAt + recallCount + archivedAt
- `parseLifecycle()` — reads lifecycle fields from frontmatter with safe defaults
- `lifecycleScoreMultiplier()` — archived memories get 0.1x score (10x deprioritized but still searchable as last resort)

**explicit-feedback Tightening**
- Three-condition detection: signal ("记住"/"always use") + action intent (verb) + user authority — descriptive observations no longer trigger auto-save
- 6 positive + 12 negative test cases covering edge cases like "用户喜欢" / "the user prefers"

**Adapter Bridge**
- `AdapterLLMProvider` wraps RuntimeAdapter as `CompletionProvider` — enables benchmark to use OpenCode's adapter without exposing store/SDK
- `extractResponseText()` — exported from extraction.ts, handles 6+ response shapes (plain string, {content}, {message.content}, OpenAI {choices}, DashScope {output.text}, {text})

**Critical Bug Fixes (post-merge)**
- **P0:** `package.json` was zeroed out by commit `0adb23a` — restored all scripts + added `repair`
- **P0:** `repair-cli.ts` hardcoded `user` scope but 21 polluting memories were in `project` scope — added `--scope project|user|all` (default project)
- **P1:** `repair-cli.ts` missing `--scan` command — scanner couldn't enqueue candidates, `--list` always empty
- **P1:** `SessionScanner` 30-day threshold skipped all recent July session_*.md — added `--include-recent-sessions` flag (threshold=0)

**Real Cleanup Executed**
- 21 candidates cleared: 13 legacy/v1/ files deleted (low risk, v2 versions exist at top level) + 8 session_*.md files archived (status field set, files retained)
- MEMORY.md rebuilt: 32 → 28 entries (4 stale legacy index entries removed)

**Test growth:** 491 → 589 tests (+98), 63 files, 0 regressions (2 pre-existing C2/C3 SDK timeouts require live OpenCode instance)

### v0.3.2 — Memory Benchmark Reality Layer (2026-07-16)

**LLM Provider Abstraction**
- `CompletionProvider` + `EmbeddingProvider` separated interfaces (not all models support embedding)
- `ModelProvider` extends `CompletionProvider` (no embedding implied — inject separately)
- `OpenAIProvider` + `OpenAIEmbeddingProvider` — fetch-based, retry with exponential backoff, timeout
- `QwenProvider` + `QwenEmbeddingProvider` — DashScope API, BGE-M3 embedding

**extractMemories() Core Function**
- Side-effect-isolated core: prompt build → LLM call → parse → validate → fingerprint dedup
- No store/adapter/IO dependency — production and benchmark share same logic
- `ExtractionInput` (messages + context + metadata) — forward-extensible for v0.4+ tool events
- `ExtractionExecutor` wraps extractMemories() for benchmark use

**Hybrid-4Layer Comparator**
- 4-layer: Token Jaccard (15%) + TF-IDF (35%) + Bigram (15%) + Embedding (35%)
- Fallback to legacy-3layer (20%+50%+30%) when embedding unavailable or fails
- `TextComparisonResult` with per-layer breakdown for explainability
- `cosineSimilarity` pure function
- `ComparableMemory.metadata` optional field (not scored in v0.3.2)

**Benchmark Cache + Repeat + Stats**
- `FileBenchmarkCache` with SHA-256 cache key: pipeline + model + runtime + caseId + **repeatIndex** (critical — without repeatIndex, repeat=3 hits same cache)
- `RepeatController` with suite-level policies: extraction=3, recall=1, dedup=3, conflict=3, forgetting=1 (110 total calls for 50 cases)
- `computeStats` pure function: mean, stddev, 95% CI (normal approximation)
- `LLMTraceLogger`: JSONL trace for cost/latency analysis

**Benchmark Config + Report**
- Separate `benchmark.config.json` (not in memory.config.json) — different lifecycles
- `stripJsoncComments`: string-aware state machine (preserves URLs inside strings)
- `substituteEnvVars`: `$VAR_NAME` → `process.env[VAR_NAME]`
- `BenchmarkReport` v0.3.2 schema with model, comparator, cost, weights metadata

**CLI Integration**
- `--mode real` — real LLM extraction benchmark
- `--provider` — openai / qwen / ollama
- `--model` — model name override
- `--repeat N` — repeat count override
- `--no-cache` — disable cache

**Self-Review Fixes (8 issues)**
- OpenAI API: removed unsupported `top_k` parameter
- Config: JSONC comment stripping now string-aware (preserves URLs)
- Extraction: `confidenceValues` + `VALID_CONFIDENCE` — added missing `observed` level
- Embedding providers: added retry logic (was missing in both OpenAI and Qwen)
- Extraction: removed redundant dynamic import of `shouldMerge`
- Config: clarified `as` + `??` operator precedence with parentheses

**Test growth:** 373 → 491 tests (+118), 55 files, 0 regressions

### v0.3.1 — Memory Quality Regression & Intelligence Benchmark (2026-07-15)

**Semantic Comparator**
- `DefaultMemoryComparator` with 3-layer text comparison: Token Jaccard (20%) + TF-IDF keyword (50%) + Character bigram (30%)
- CJK-aware tokenization (2-char bigram tokens for Chinese text)
- `compareMemory` field-weighted comparison: content (50%), description (20%), type (20%), name (10%)
- `ComparisonResult` with per-field scores and pass threshold

**Golden Benchmark Framework**
- `GoldenExecutor` wraps runtime executor + semantic comparator
- `GoldenCase` interface extends `BenchmarkCase` with model/reviewer/createdAt metadata
- 50 golden dataset cases: Extraction (15), Recall (15), Dedup (8), Conflict (7), Forgetting (5)
- `BenchmarkReport` upgraded: `intelligence_score` + per-suite score breakdown + v0.3.1 version

**Memory Quality Score**
- `MemoryQualityEvaluator` with 5 dimensions: Completeness (20%), Consistency (25%), Freshness (15%), Noise (20%), Retrievability (20%)
- `QualityReport` with overall score and per-dimension breakdown
- Pure dimension functions (no I/O, no side effects)

**CLI Tools**
- `bun run quality` — scan memory, output 5-dimension quality report
- `bun run benchmark --mode golden` — run golden benchmark with semantic comparison
- Flags: `--json`, `--scope`, `--mode golden`

**Self-Review Fixes** (commit `59b4a15`)
- `GoldenExecutor`: removed redundant `threshold` field — single threshold source via comparator's `passed` flag
- `BenchmarkReport`: `benchmarks` array marked `@deprecated`, derived from `suites` Record — single data source
- `checkConsistency`: bucket-optimized O(n·k) with range `[s - floor(s/4), s + floor(s/4)]` (min ±1) — 11x speedup over O(n²), no false negatives at Jaccard=0.8 boundary
- `extractKeywords`: version-like tokens (`Python 3.10`) preserved as single token (`3_10`) — `3.10` no longer false-positive-duplicates `3.11`

**Test growth:** 258 → 350 tests (+92), 43 files, 0 regressions

### v0.3.0 — Memory Observability & Evaluation Foundation (2026-07-15)

**Evaluation Layer**
- Evaluation primitives (types, metrics, fingerprint, scoring, comparison) as independent shared layer
- `fingerprint.ts` migrated from `src/` to `src/evaluation/` (re-export shim for backward compat)
- `scoreMemory` extracted from `recall.ts` to `src/evaluation/scoring.ts`
- `SemanticComparator<T>` generic interface + `TokenJaccardComparator` + `ArrayOverlapComparator`

**Audit Module**
- `MemoryAuditService` with plugin-pattern analyzer registration
- 4 analyzers: Duplicate (TF-IDF), Conflict (pair-wise + version/tech-switch), Quality (frontmatter), Staleness (180-day)
- Read-only constraint: never modifies memory files
- Report generation: JSON/Markdown/Console with severity scoring

**Benchmark Framework**
- `BenchmarkRunner` + `BenchmarkExecutor` strategy pattern (runner = orchestration, executor = per-case)
- `MockExecutor` with strict (returns expected) + adversarial (returns garbage) dual mode
- 5 test suites: Dedup, Recall, Conflict, ExtractionPipeline, Forgetting
- 11 benchmark cases with real-session-style data
- Report with environment metadata + baseline support

**CLI Tools**
- `bun run audit` — scan memory health, output findings + suggestions
- `bun run benchmark` — run evaluation suites in mock mode
- Flags: `--json`, `--scope`, `--suite`, `--format`, `--adversarial`

**Fixes**
- `store.ts` LSP type annotation fix (recall_count, last_recalled_at in inline type)
- Conflict analyzer precision fix (101 false positives → 0, pair-wise + dedup)
- `vitest` added to devDependencies (LSP type resolution for test files)
- N-issue fixes: `uncertain:0` in promotion, `$id` with sessionId, `DreamMode` union type

**Test growth:** 216 → 258 tests (+42), 34 files, 0 regressions

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
