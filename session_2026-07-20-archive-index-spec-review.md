---
name: "Session: v0.3.4 Archive-Index Spec Review"
description: "8-point architectural review of the archive-index spec with spec patches"
type: project
scope: project
confidence: explicit
status: archived
archivedAt: 1784619800000
schema_version: 1
---
# Session: v0.3.4 Archive-Index Spec Review

**日期**: 2026-07-20
**分支**: main
**HEAD**: `9d49888`
**Spec files reviewed**:
- `docs/superpowers/specs/v0.3.4/00-overview.md`
- `docs/superpowers/specs/v0.3.4/04-archive-index.md`

## Current State

Completed the 8-point architectural review of the v0.3.4 archive-index spec. Identified 4 P0 gaps (atomicity protocol, conflict detection, migration dry-run, backup strategy) and 1 P1 gap (auto-generated manifest marker). All findings come with concrete, ready-to-apply spec patches. The user's revised 8-step implementation order was evaluated and recommended over the spec's current 10-step order. Test count was found undercounted (34 → 48).

## Task Specification

The user asked for a structured architectural review of the v0.3.4 archive-index spec, evaluating 8 specific concerns against the spec text. The user explicitly framed this as NOT a generic plan review — they had pre-identified 8 architectural concerns (R1-R8) that needed verification.

**Context**: v0.3.3 is complete and pushed (commit 9d49888, 587/589 tests pass), 7 architectural decisions are LOCKED in 00-overview.md, 2 spec files need to be read in full.

## Files & Functions

- `docs/superpowers/specs/v0.3.4/04-archive-index.md` — Phase 0 spec for archive index (ARCHIVE.md manifest, rebuild partitioning, migration, tests)
- `docs/superpowers/specs/v0.3.4/00-overview.md` — Locked decisions, scope, expected outcomes
- `src/lifecycle/types.ts` — Existing lifecycle: LifecycleMetadata, MemoryStatus, parseLifecycle, lifecycleScoreMultiplier (61 lines)
- `src/store.ts` — FileSystemStore (243 lines, 5 concerns)
- `src/promotion.ts` — rebuildMemoryIndex current behavior
- `src/evaluation/fingerprint.ts` — TF-IDF + Jaccard for duplicate detection

## Workflow

Review process:
1. Read both spec files → understand locked decisions + Phase 0 scope
2. Read existing lifecycle/store/promotion code → ground evaluation in codebase reality
3. Evaluate each of the 8 review points against spec text with line-number citations
4. Produce verdict (PASS/GAP/CONTRADICTION) + concrete spec patch for each
5. Compare implementation orders (spec's 10-step vs user's 8-step)
6. Evaluate test count (spec says 34, user argues 44+)

## Errors & Corrections

Spec's Section 4.2 has no atomicity protocol — archive sequence is described linearly but the manifest write after frontmatter write creates an orphan window. Patched with a 3-phase atomic swap (prepare → manifest pair first → frontmatter last → audit).

Section 5 restore has no duplicate conflict check — blind restore could produce two near-identical active files. Patched with DuplicateScanner fallback using `evaluation/fingerprint.ts`.

Section 8 mentions `--dry-run` textually but the code example only parses `--scope`. No `--apply` flag. No confirmation prompt. No backup strategy before the first index contract change.

## Learnings

- The spec format is opinionated but clean: one file per spec module, locked decisions isolated in overview, Phase boundaries explicit.
- When evaluating specs, always check: does the code example implement what the text describes? (R7 caught this — `--dry-run` in text but not in code)
- 4 P0 gaps was the right bar — the user asked for precision over thoroughness, and delivering 4 concrete P0 patches + 1 P1 patch + implementation order + test count analysis was a complete answer.
- The existing codebase already has `evaluation/fingerprint.ts` — using it as a Phase 0 fallback for conflict detection avoids waiting for Phase 3's DuplicateScanner.

## Worklog

1. Read both spec files (00-overview.md, 04-archive-index.md) with line-level detail
2. Read `src/lifecycle/types.ts` to ground ArchiveEntry type decisions
3. Read `src/store.ts` and `src/promotion.ts` via codegraph to understand current rebuild format
4. Evaluated R1-R8 in sequence, producing verdict + finding + patch for each
5. Evaluated implementation order: user's types → index manager → rebuild → repair → migration → memory_list → tests is structurally better
6. Evaluated test count: spec's 34 is undercounted; real number is 48 (34 new + 10 regression + 4 delta in repair/migration)
7. Produced summary table: 4 P0, 1 P1, 2 P2, test count P0, implementation order P1
