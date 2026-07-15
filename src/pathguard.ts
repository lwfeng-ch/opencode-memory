/**
 * opencode-memory — Memory Path Guard
 *
 * Security layer for the auto-write memory system. Prevents:
 *   - Path traversal (../)
 *   - Absolute path injection
 *   - Null byte injection
 *   - Symlink attacks (symlinks pointing outside the memory directory)
 *
 * Inspired by Qwen Code's symlink protection. Defense-in-depth: this guard
 * adds a security check layer alongside the existing store.ts resolvePath check.
 *
 * All path checks are pure; symlink check requires I/O (lstat/readlink).
 */

import { lstat, readlink, realpath } from "fs/promises"
import { isAbsolute, relative, join } from "path"

/**
 * Check if a filename is safe to use within a memory directory.
 * Pure function — no I/O.
 *
 * Rejects:
 *   - Absolute paths (/etc/passwd, C:\Windows\...)
 *   - Path traversal (../, ..\)
 *   - Null bytes
 */
export function isSafePath(filename: string, _baseDir: string): boolean {
  // Null byte injection
  if (filename.includes("\0")) return false

  // Absolute path
  if (isAbsolute(filename)) return false

  // Path traversal — check for .. segments
  const parts = filename.split(/[/\\]/)
  if (parts.some((p) => p === "..")) return false

  return true
}

/**
 * Check if a file path is safe from symlink attacks.
 * Requires I/O — checks if the file is a symlink and whether it points
 * outside the memory directory.
 *
 * @returns true if safe (not a symlink, or symlink target is inside baseDir)
 */
export async function checkSymlinkSafe(
  filePath: string,
  baseDir: string,
): Promise<boolean> {
  try {
    const stats = await lstat(filePath)
    if (!stats.isSymbolicLink()) return true

    // It's a symlink — resolve the target and check if it's inside baseDir
    const target = await readlink(filePath)
    const resolvedTarget = isAbsolute(target) ? target : join(filePath, "..", target)

    // Resolve to absolute path
    const realTarget = await realpath(resolvedTarget).catch(() => resolvedTarget)
    const realBase = await realpath(baseDir).catch(() => baseDir)

    // Check if the resolved target is inside the base directory
    const rel = relative(realBase, realTarget)
    if (rel.startsWith("..") || isAbsolute(rel)) return false

    return true
  } catch {
    // File doesn't exist or lstat failed — treat as safe (will be created)
    return true
  }
}
