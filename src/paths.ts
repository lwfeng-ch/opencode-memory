import { join, normalize, sep } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Sanitize a path for use as a directory name (slashes → dashes). */
export function sanitizePath(p: string): string {
  return p.replace(/[/\\:]/g, '-');
}

/** Find the canonical git root (shared across worktrees). Returns null if not a git repo. */
export async function findGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 2000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Get the memory directory path: ~/.config/opencode/memory/projects/<sanitized-git-root>/ */
export async function getMemoryDir(directory: string, worktree: string): Promise<string> {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("getMemoryDir requires a non-empty directory path");
  }
  if (typeof worktree !== "string" || worktree.length === 0) {
    throw new Error("getMemoryDir requires a non-empty worktree path");
  }
  const gitRoot = await findGitRoot(worktree);
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

/** Get the fact directory: <memoryDir>/fact/sessions/ */
export function getFactDir(memoryDir: string): string {
  return join(memoryDir, 'fact', 'sessions');
}

/** Get the processing directory: <memoryDir>/processing/ */
export function getProcessingDir(memoryDir: string): string {
  return join(memoryDir, 'processing');
}

/** Get the semantic directory: <memoryDir>/semantic/ */
export function getSemanticDir(memoryDir: string): string {
  return join(memoryDir, 'semantic');
}

/** Get the staging directory: <memoryDir>/semantic/staging/ */
export function getStagingDir(memoryDir: string): string {
  return join(memoryDir, 'semantic', 'staging');
}

/** Get the conflicts directory: <memoryDir>/semantic/conflicts/ */
export function getConflictsDir(memoryDir: string): string {
  return join(memoryDir, 'semantic', 'conflicts');
}

/** Get the legacy backup directory: <memoryDir>/legacy/v1/ */
export function getLegacyDir(memoryDir: string): string {
  return join(memoryDir, 'legacy', 'v1');
}

/** Get the fact session file path: <memoryDir>/fact/sessions/YYYY/MM/session_xxx.json */
export function getFactSessionPath(memoryDir: string, sessionId: string, date?: Date): string {
  const d = date ?? new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return join(memoryDir, 'fact', 'sessions', yyyy, mm, `session_${sessionId}.json`);
}