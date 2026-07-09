import { writeFile, unlink, stat, readFile } from 'fs/promises';

/**
 * Lock file management for dream consolidation.
 *
 * The lock file serves dual purpose (ported from Claude Code):
 * - Content = holder's PID (mutual exclusion)
 * - mtime = lastConsolidatedAt (scheduling state)
 *
 * PID reuse is theoretically possible, but the 1-hour stale timeout
 * (recommended minimum) makes accidental re-acquisition by a new process
 * that reuses an old PID vanishingly unlikely.
 */

/**
 * Acquire a lock. Returns true if acquired, false if held by another live process.
 */
export async function acquireLock(lockPath: string, staleTimeoutMs: number): Promise<boolean> {
  // Fast path: try atomic creation (O_CREAT | O_EXCL)
  try {
    await writeFile(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      // An unexpected error occurred (e.g. permission denied); treat as lock not acquired.
      return false;
    }
  }

  // Lock exists — read current holder's PID and check liveness.
  try {
    const [content, stats] = await Promise.all([
      readFile(lockPath, 'utf-8'),
      stat(lockPath),
    ]);

    const pid = parseInt(content, 10);
    const isAlive = isProcessAlive(pid);
    const isStale = Date.now() - stats.mtimeMs > staleTimeoutMs;

    // Overwrite if holder is dead or lock is stale
    if (!isAlive || isStale) {
      await writeFile(lockPath, String(process.pid), { flag: 'w' });
      return true;
    }

    // Lock is held by a live process and fresh
    return false;
  } catch {
    // Race: lock was deleted between our EEXIST and read, or other I/O error.
    // Attempt atomic creation once more.
    try {
      await writeFile(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Release a lock by deleting the file.
 */
export async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (err: unknown) {
    // ENOENT means already released — no-op.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Get the mtime of the lock file (lastConsolidatedAt). Returns 0 if no lock file.
 */
export async function getLockMtime(lockPath: string): Promise<number> {
  try {
    const stats = await stat(lockPath);
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Check if a lock is currently held by a live process.
 */
export async function isLockHeld(lockPath: string, staleTimeoutMs: number): Promise<boolean> {
  try {
    const [content, stats] = await Promise.all([
      readFile(lockPath, 'utf-8'),
      stat(lockPath),
    ]);

    const pid = parseInt(content, 10);
    if (!isProcessAlive(pid)) {
      return false;
    }

    // Check staleness
    if (Date.now() - stats.mtimeMs > staleTimeoutMs) {
      return false;
    }

    return true;
  } catch {
    // Lock file doesn't exist or can't be read
    return false;
  }
}

/**
 * Check whether a given PID corresponds to a live process.
 * Uses signal 0 which tests for process existence without sending a signal.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH = no such process, EPERM = process exists but we can't signal it (still alive)
    return code === 'EPERM';
  }
}
