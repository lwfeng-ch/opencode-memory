/**
 * Tests for v0.3.4 Phase 1 — Lifecycle-Aware Quality Evaluation
 *
 * Verifies:
 * - Active quality only scores status=active files
 * - Archived files don't affect active quality
 * - Archive hygiene correctly scores archived files
 * - Gate score formula is correct
 * - Backward-compatible overall field
 */

import { describe, it, expect } from 'vitest'
import { DefaultMemoryQualityEvaluator } from '../../src/evaluation/quality-score.js'
import type { QualityMemory } from '../../src/evaluation/quality-score.js'

function makeMemory(overrides: Partial<QualityMemory> & { filename: string }): QualityMemory {
  return {
    content: 'test content',
    name: 'Test Memory',
    description: 'A test memory for quality evaluation',
    type: 'project',
    scope: 'project',
    confidence: 'inferred',
    recallCount: 1,
    lastRecalledAt: new Date().toISOString(),
    mtimeMs: Date.now(),
    status: 'active',
    archivedAt: null,
    ...overrides,
  }
}

describe('DefaultMemoryQualityEvaluator (v0.3.4 lifecycle-aware)', () => {
  const evaluator = new DefaultMemoryQualityEvaluator()

  it('should return activeQuality=100, archiveHygiene=100 when all files are active', () => {
    const memories = [
      makeMemory({ filename: 'a.md', content: 'User is a senior Go engineer with 10 years experience.', recallCount: 1 }),
      makeMemory({ filename: 'b.md', content: 'Project uses React frontend with TypeScript.', recallCount: 1 }),
    ]
    const report = evaluator.evaluate(memories)
    expect(report.activeQuality.score).toBe(100)
    expect(report.archiveHygiene.score).toBe(100)
    expect(report.archiveHygiene.count).toBe(0)
  })

  it('should partition active vs archived correctly', () => {
    const memories = [
      makeMemory({ filename: 'active.md', status: 'active' }),
      makeMemory({ filename: 'archived.md', status: 'archived' }),
    ]
    const report = evaluator.evaluate(memories)
    expect(report.activeQuality.count).toBe(1)
    expect(report.archiveHygiene.count).toBe(1)
  })

  it('should compute gateScore = activeQuality × (active/(active+archived))', () => {
    const memories = [
      makeMemory({ filename: 'a.md', status: 'active', content: 'User is a senior Go engineer with 10 years experience.', recallCount: 1 }),
      makeMemory({ filename: 'b.md', status: 'active', content: 'Project uses React frontend with TypeScript.', recallCount: 1 }),
      makeMemory({ filename: 'c.md', status: 'archived', content: 'Old session memory about project setup.', recallCount: 0 }),
      makeMemory({ filename: 'd.md', status: 'archived', content: 'Old session memory about database config.', recallCount: 0 }),
    ]
    const report = evaluator.evaluate(memories)
    const expectedGate = Math.round(report.activeQuality.score * (2 / 4) * 10) / 10
    expect(report.gateScore).toBe(expectedGate)
  })

  it('should set overall = gateScore (backward compat)', () => {
    const memories = [
      makeMemory({ filename: 'a.md', status: 'active' }),
      makeMemory({ filename: 'b.md', status: 'archived' }),
    ]
    const report = evaluator.evaluate(memories)
    expect(report.overall).toBe(report.gateScore)
  })

  it('should return archiveHygiene=100 when no archived files', () => {
    const memories = [makeMemory({ filename: 'a.md', status: 'active' })]
    const report = evaluator.evaluate(memories)
    expect(report.archiveHygiene.score).toBe(100)
    expect(report.archiveHygiene.count).toBe(0)
  })

  it('should detect archive frontmatter issues', () => {
    const memories = [
      makeMemory({ filename: 'bad.md', status: 'archived', name: '', description: null, archivedAt: null }),
    ]
    const report = evaluator.evaluate(memories)
    // Missing name (-15), description (-15), archivedAt (-20) = 50 deduction
    // max penalty = 90, so score = round(100 - 50/90*100) = round(44.4) = 44
    expect(report.archiveHygiene.dimensions.frontmatter).toBeLessThan(100)
    expect(report.archiveHygiene.score).toBeLessThan(100)
  })

  it('should produce JSON-serializable output', () => {
    const memories = [makeMemory({ filename: 'a.md', status: 'active' })]
    const report = evaluator.evaluate(memories)
    const json = JSON.stringify(report)
    const parsed = JSON.parse(json)
    expect(parsed.activeQuality.score).toBeTypeOf('number')
    expect(parsed.archiveHygiene.score).toBeTypeOf('number')
    expect(parsed.gateScore).toBeTypeOf('number')
    expect(parsed.overall).toBeTypeOf('number')
  })

  it('should handle empty memory list', () => {
    const report = evaluator.evaluate([])
    expect(report.activeQuality.score).toBe(100)
    expect(report.activeQuality.count).toBe(0)
    expect(report.archiveHygiene.score).toBe(100)
    expect(report.archiveHygiene.count).toBe(0)
    expect(report.gateScore).toBe(100)
  })

  it('should not let archived files affect active quality score', () => {
    // Create 10 near-perfect active with distinct content + 9 garbage archived
    const topics = [
      'Senior Go engineer prefers PostgreSQL for data layer.',
      'React frontend uses TypeScript with strict mode enabled.',
      'Docker compose runs three services with health checks.',
      'CI pipeline runs linting tests and deployment stages.',
      'API design follows RESTful principles with versioning.',
      'Database schema uses UUID primary keys for all tables.',
      'Authentication flow implements JWT with refresh tokens.',
      'Monitoring stack uses Prometheus and Grafana dashboards.',
      'Deployment targets Kubernetes cluster with auto-scaling.',
      'Logging strategy uses structured JSON format for parsing.',
    ]
    const active = Array.from({ length: 10 }, (_, i) =>
      makeMemory({
        filename: `active_${i}.md`,
        status: 'active',
        content: topics[i],
        recallCount: 5,
        confidence: 'explicit',
      }),
    )
    const archived = Array.from({ length: 9 }, (_, i) =>
      makeMemory({
        filename: `archived_${i}.md`,
        status: 'archived',
        content: '',
        name: '',
        description: null,
        recallCount: 0,
        archivedAt: null,
      }),
    )
    const report = evaluator.evaluate([...active, ...archived])

    // Active quality should be high (memories are complete + fresh)
    expect(report.activeQuality.score).toBeGreaterThanOrEqual(80)
    // Archive hygiene should detect issues (missing metadata + empty content)
    expect(report.archiveHygiene.score).toBeLessThan(80)
    // Gate score should reflect coverage
    expect(report.gateScore).toBeLessThan(report.activeQuality.score)
  })

  it('should handle mixed status assignment', () => {
    const memories = [
      makeMemory({ filename: 'a.md', status: 'active' }),
      makeMemory({ filename: 'b.md', status: 'archived' }),
      makeMemory({ filename: 'c.md' }), // no status = active
    ]
    const report = evaluator.evaluate(memories)
    expect(report.activeQuality.count).toBe(2) // a + c (c has no status = active)
    expect(report.archiveHygiene.count).toBe(1) // b
  })
})