// Linked git worktrees: with parallel_tasks=worktrees each executor gets its own checkout of the
// project. The crew's state (.crew/) and policy still live in the main checkout, so both the hooks
// and the crew CLI need to tell the two apart. Hand-written, shared by them.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The linked worktree a folder is in, with the main checkout it belongs to — or undefined in the
 * main checkout and outside git. A linked worktree has a `.git` *file* that points into
 * `<main>/.git/worktrees/<name>`.
 * @returns {{ worktree: string, main: string } | undefined}
 */
export function linkedWorktree(dir) {
  let current = real(dir);
  for (;;) {
    const dotGit = path.join(current, '.git');
    if (existsSync(dotGit)) {
      let isFile = false;
      try {
        isFile = statSync(dotGit).isFile();
      } catch {
        return undefined;
      }
      if (!isFile) return undefined; // the main checkout
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
      const gitDir = m ? path.resolve(current, m[1]) : '';
      const k = gitDir.replace(/\\/g, '/').lastIndexOf('/.git/worktrees/');
      return k > 0 ? { worktree: current, main: real(gitDir.slice(0, k)) } : undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** The main checkout for a folder: itself unless it is in a linked worktree. */
export function mainCheckout(dir) {
  return linkedWorktree(dir)?.main ?? dir;
}
