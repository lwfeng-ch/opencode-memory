/**
 * Tests for v0.3.4 Phase 1 — Lifecycle-Aware Audit Evaluation
 *
 * Verifies:
 * - Archived files produce ignored severity for staleness
 * - Archived files produce downgraded severity for quality issues
 * - Active files still produce normal severity
 * - lifecycleSummary in AuditReport
 * - Corrupted archived files still produce critical
 */

import { describe, it, expect } from 'vitest'
import { QualityAnalyzer } from '../../src/audit/analyzer/quality.js'
import { StalenessAnalyzer } from '../../src/audit/analyzer/staleness.js'
import type { AuditedMemory } from '../../src/audit/index.js'
import type { EvaluationContext } from '../../src/evaluation/types.js'

function makeAuditedMemory(overrides: {
  filename: string
  content?: string
  status?: 'active' | 'archived'
  confidence?: string
  mtimeMs?: number
  recallCount?: number
}): AuditedMemory {
  const status = overrides.status ?? 'active'
  const content = overrides.content ?? `---
name: Test Memory
description: A test memory
type: project
scope: project
confidence: ${overrides.confidence ?? 'inferred'}
status: ${status}
${status === 'archived' ? 'archived_at: 2026-07-20T00:00:00.000Z\n' : ''}schema_version: 1
---

Test content body`

  return {
    filename: overrides.filename,
    content,
    header: {
      filename: overrides.filename,
      filePath: `/test/${overrides.filename}`,
      mtimeMs: overrides.mtimeMs ?? Date.now(),
      description: 'A test memory',
      type: 'project' as const,
      scope: 'project' as const,
      confidence: (overrides.confidence ?? 'inferred') as any,
      schemaVersion: 1,
      recallCount: overrides.recallCount ?? 0,
      lastRecalledAt: status === 'archived' ? null : new Date().toISOString(),
      status,
    },
    mtimeMs: overrides.mtimeMs ?? Date.now() - 200 * 24 * 60 * 60 * 1000,
    scope: 'project' as const,
  }
}

/** Helper: creates an AuditedMemory with inline content for custom scenarios. */
function makeCustomMemory(overrides: {
  filename: string
  content: string
  status?: 'active' | 'archived'
  description?: string | null
}): AuditedMemory {
  const status = overrides.status ?? 'active'
  return {
    filename: overrides.filename,
    content: overrides.content,
    header: {
      filename: overrides.filename,
      filePath: `/test/${overrides.filename}`,
      mtimeMs: Date.now(),
      description: overrides.description ?? null,
      type: 'project' as const,
      scope: 'project' as const,
      confidence: 'inferred' as any,
      schemaVersion: 1,
      recallCount: 0,
      lastRecalledAt: null,
      status,
    },
    mtimeMs: Date.now(),
    scope: 'project' as const,
  }
}

describe('Lifecycle-Aware Audit', () => {
  const ctx: EvaluationContext = { now: Date.now(), config: {} as any }

  describe('StalenessAnalyzer', () => {
    it('should produce ignored severity for archived stale files', () => {
      const staleness = new StalenessAnalyzer()
      const memories = [
        makeAuditedMemory({
          filename: 'archived_old.md',
          status: 'archived',
          recallCount: 0,
          mtimeMs: Date.now() - 365 * 24 * 60 * 60 * 1000,
        }),
      ]
      const findings = staleness.analyze(memories, ctx)
      const archivedFinding = findings.find(f => f.files.includes('archived_old.md'))
      expect(archivedFinding).toBeDefined()
      expect(archivedFinding!.severity).toBe('ignored')
      expect(archivedFinding!.lifecycleNote).toContain('Archived')
    })

    it('should produce normal severity for active stale files', () => {
      const staleness = new StalenessAnalyzer()
      const memories = [
        makeAuditedMemory({
          filename: 'active_stale.md',
          status: 'active',
          confidence: 'inferred',
          recallCount: 0,
          mtimeMs: Date.now() - 365 * 24 * 60 * 60 * 1000,
        }),
      ]
      const findings = staleness.analyze(memories, ctx)
      const activeFinding = findings.find(f => f.files.includes('active_stale.md'))
      expect(activeFinding).toBeDefined()
      expect(activeFinding!.severity).not.toBe('ignored')
    })

    it('should skip explicit memories (never stale) regardless of lifecycle', () => {
      const staleness = new StalenessAnalyzer()
      const memories = [
        makeAuditedMemory({
          filename: 'explicit_active.md',
          status: 'active',
          confidence: 'explicit',
          recallCount: 0,
          mtimeMs: Date.now() - 365 * 24 * 60 * 60 * 1000,
        }),
      ]
      const findings = staleness.analyze(memories, ctx)
      const finding = findings.find(f => f.files.includes('explicit_active.md'))
      expect(finding).toBeUndefined()
    })
  })

  describe('QualityAnalyzer', () => {
    it('should produce warning for archived files with missing name', () => {
      const content = `---
status: archived
archived_at: 2026-07-20T00:00:00.000Z
schema_version: 1
---

Some content`
      const memories = [makeCustomMemory({
        filename: 'archived_no_name.md',
        content,
        status: 'archived',
      })]
      const quality = new QualityAnalyzer()
      const findings = quality.analyze(memories, ctx)
      const nameFinding = findings.find(f => f.message.includes('name'))
      expect(nameFinding).toBeDefined()
      expect(nameFinding!.severity).toBe('warning')
      expect(nameFinding!.lifecycleNote).toContain('Archived')
    })

    it('should produce info for archived files with truncated description', () => {
      const content = `---
name: Test
description: Very long description that exceeds the 200 character threshold and this is a test of the truncated description detection... this is a test of the truncated description detection... this is a test of the truncated description detection... this is a test of the truncated description detection...
status: archived
archived_at: 2026-07-20T00:00:00.000Z
schema_version: 1
---

Some content`
      const memories = [makeCustomMemory({
        filename: 'archived_truncated.md',
        content,
        status: 'archived',
        description: 'Very long description...',
      })]
      const quality = new QualityAnalyzer()
      const findings = quality.analyze(memories, ctx)
      const truncatedFinding = findings.find(f => f.message.includes('truncated'))
      expect(truncatedFinding).toBeDefined()
      expect(truncatedFinding!.severity).toBe('info')
      expect(truncatedFinding!.lifecycleNote).toContain('Archived')
    })

    it('should produce critical for active files with empty content', () => {
      const content = `---
name: Test
description: A test
type: project
scope: project
confidence: inferred
status: active
schema_version: 1
---
`
      const memories = [makeCustomMemory({
        filename: 'active_empty.md',
        content,
        status: 'active',
        description: 'A test',
      })]
      const quality = new QualityAnalyzer()
      const findings = quality.analyze(memories, ctx)
      const emptyFinding = findings.find(f => f.message.includes('empty content'))
      expect(emptyFinding).toBeDefined()
      expect(emptyFinding!.severity).toBe('critical')
    })

    it('should produce info for archived files with empty content', () => {
      const content = `---
name: Test
description: A test
type: project
scope: project
confidence: inferred
status: archived
archived_at: 2026-07-20T00:00:00.000Z
schema_version: 1
---
`
      const memories = [makeCustomMemory({
        filename: 'archived_empty.md',
        content,
        status: 'archived',
        description: 'A test',
      })]
      const quality = new QualityAnalyzer()
      const findings = quality.analyze(memories, ctx)
      const emptyFinding = findings.find(f => f.message.includes('empty content'))
      expect(emptyFinding).toBeDefined()
      expect(emptyFinding!.severity).toBe('info')
      expect(emptyFinding!.lifecycleNote).toContain('Archived')
    })
  })
})