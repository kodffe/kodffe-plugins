// Thin wrappers around the git CLI. Paths come from git itself so they also work in worktrees.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function git(args, { cwd, input, allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args[0]} failed: ${detail}`, { cause: error });
  }
}

/** Top-level folder of the current checkout (a linked worktree returns its own folder). */
export function repoRoot(cwd) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
  return root || null;
}

/** The .git folder shared by every worktree of the repository. */
export function commonDir(cwd) {
  return resolve(cwd, git(['rev-parse', '--git-common-dir'], { cwd }));
}
