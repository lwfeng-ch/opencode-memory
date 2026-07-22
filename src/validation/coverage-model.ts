/**
 * opencode-memory — CoverageModel (v0.4.1)
 *
 * Coverage calibration for GateScore. Different store sizes use different
 * curves to prevent over-penalization on small stores and under-penalization
 * on large stores.
 *
 * See: docs/superpowers/specs/v0.4.1/03-coverage-calibration.md
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CoverageModel {
  readonly name: string
  calculate(active: number, total: number): number
}

// ---------------------------------------------------------------------------
// LinearBufferedCoverage (total < 100)
// ---------------------------------------------------------------------------

/**
 * Linear with a 0.5 buffer floor. Small stores shouldn't be overly penalized
 * for having archived memories — the buffer ensures the minimum effective
 * coverage is 0.5 even when raw coverage is 0.
 *
 * Formula: 0.5 + 0.5 × (active / total)
 */
export class LinearBufferedCoverage implements CoverageModel {
  readonly name = "linear-buffered"

  calculate(active: number, total: number): number {
    if (total <= 0) return 1
    const raw = active / total
    return 0.5 + 0.5 * raw
  }
}

// ---------------------------------------------------------------------------
// SqrtCoverage (100 ≤ total < 1000)
// ---------------------------------------------------------------------------

/**
 * Square root scaling. In medium stores, archive is a normal part of the
 * lifecycle — sqrt reduces the penalty compared to linear.
 *
 * Formula: sqrt(active / total)
 */
export class SqrtCoverage implements CoverageModel {
  readonly name = "sqrt"

  calculate(active: number, total: number): number {
    if (total <= 0) return 1
    return Math.sqrt(active / total)
  }
}

// ---------------------------------------------------------------------------
// LogCoverage (total ≥ 1000)
// ---------------------------------------------------------------------------

/**
 * Logarithmic scaling. In large stores, a high archive ratio is healthy.
 * Log ensures archive doesn't dominate the coverage score.
 *
 * Formula: log(active + 1) / log(total + 1)
 */
export class LogCoverage implements CoverageModel {
  readonly name = "log"

  calculate(active: number, total: number): number {
    if (total <= 0) return 1
    return Math.log(active + 1) / Math.log(total + 1)
  }
}

// ---------------------------------------------------------------------------
// Auto-selection
// ---------------------------------------------------------------------------

export function selectCoverageModel(total: number): CoverageModel {
  if (total >= 1000) return new LogCoverage()
  if (total >= 100) return new SqrtCoverage()
  return new LinearBufferedCoverage()
}