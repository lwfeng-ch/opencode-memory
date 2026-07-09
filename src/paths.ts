import { join, normalize, sep } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';
import { execSync } from 'child_process';

/** Sanitize a path for use as a directory name (slashes → dashes). */
export function sanitizePath(p: string): string {
  return p.replace(/[/\\:]/g, '-');
}

/** Find the canonical git root (shared across worktrees). Returns null if not a git repo. */
export function findGitRoot(dir: string): string | null {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return root.trim();
  } catch {
    return null;
  }
}

/** Get the memory directory path: ~/.config/opencode/memory/projects/<sanitized-git-root>/ */
export function getMemoryDir(directory: string, worktree: string): string {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("getMemoryDir requires a non-empty directory path");
  }
  if (typeof worktree !== "string" || worktree.length === 0) {
    throw new Error("getMemoryDir requires a non-empty worktree path");
  }
  const gitRoot = findGitRoot(worktree);
  const base = gitRoot ?? directory;
  const sanitized = sanitizePath(base);
  return join(homedir(), '.config', 'opencode', 'memory', 'projects', sanitized);
}

/**
 * Get the user-level (cross-project) memory directory.
 * Stores memories shared across ALL projects: user identity, global feedback.
 * Path: ~/.config/opencode/memory/user/
 */
export function getUserMemoryDir(): string {
  return join(homedir(), '.config', 'opencode', 'memory', 'user');
}

/** Get the MEMORY.md entrypoint path. */
export function getMemoryEntrypoint(memoryDir: string): string {
  return join(memoryDir, 'MEMORY.md');
}

/** Get the daily log path: <memoryDir>/logs/YYYY/MM/YYYY-MM-DD.md */
export function getDailyLogPath(memoryDir: string, date?: Date): string {
  const d = date ?? new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return join(memoryDir, 'logs', yyyy, mm, `${yyyy}-${mm}-${dd}.md`);
}

/** Ensure a memory directory exists. Idempotent — swallows EEXIST. */
export async function ensureMemoryDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
}

/** Check if a path is within the memory directory (security check). */
export function isMemoryPath(absolutePath: string, memoryDir: string): boolean {
  const normalizedPath = normalize(absolutePath);
  const normalizedDir = normalize(memoryDir);
  // Ensure the dir ends with a separator so we don't match sibling prefixes
  const dirWithSep = normalizedDir.endsWith(sep) ? normalizedDir : normalizedDir + sep;
  return normalizedPath.startsWith(dirWithSep);
}