/**
 * Staleness awareness for memory files.
 *
 * These functions compute how old a memory is and render it in a form that
 * language models can reason about. Models are poor at date arithmetic — an
 * ISO timestamp like `2026-03-14T08:30:00.000Z` does not trigger staleness
 * reasoning, whereas a relative string like "47 days ago" does. Converting to
 * a human-readable age bridges that gap, making models more likely to
 * correctly discount stale observations.
 *
 * All functions are pure: no I/O, no model calls, no side effects.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Number of whole days elapsed since `mtimeMs`. Floor-rounded.
 *
 * - 0 for any time today (even if only a minute ago)
 * - 1 for yesterday
 * - Negative values clamp to 0 (future timestamps → 0)
 */
export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / MS_PER_DAY));
}

/**
 * Human-readable age string.
 *
 * Returns "today" for 0 days, "yesterday" for 1 day, and "N days ago" for
 * anything older. Models are poor at date arithmetic — use this instead of
 * raw timestamps so staleness is immediately obvious to the model.
 */
export function memoryAge(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/**
 * Plain-text staleness caveat for memories older than `warnAfterDays`.
 *
 * Returns an empty string when the memory is still fresh (days <= warnAfterDays).
 * When stale, returns a caveat explaining that memories are point-in-time
 * observations and may be outdated.
 */
export function memoryFreshnessText(
  mtimeMs: number,
  warnAfterDays: number,
): string {
  const d = memoryAgeDays(mtimeMs);
  if (d <= warnAfterDays) return "";
  return (
    `This memory is ${d} days old. ` +
    "Memories are point-in-time observations, not live state — " +
    "claims about code behavior or file:line citations may be outdated. " +
    "Verify against current code before asserting as fact."
  );
}

/**
 * Staleness note wrapped in `<system-reminder>` tags.
 *
 * Returns an empty string when the memory is fresh.
 * When stale, returns the freshness text enclosed in system-reminder tags
 * with a trailing newline, suitable for injection into the model's context.
 */
export function memoryFreshnessNote(
  mtimeMs: number,
  warnAfterDays: number,
): string {
  const text = memoryFreshnessText(mtimeMs, warnAfterDays);
  if (text === "") return "";
  return `<system-reminder>${text}</system-reminder>\n`;
}
