// Node file-system helpers for writers that run in hooks, bin/crew and the eval runner.

import { mkdir, open, readdir, appendFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { type IdKind, idNumber, formatId } from './ids';

/**
 * Creates `<dir>/<id>.md` with the next free id, exclusively. Two writers racing for the same
 * id both see EEXIST except one, and the loser retries with the next number.
 */
export async function createWithNextId(
  dir: string,
  kind: IdKind,
  render: (id: string) => string,
  options: { fileName?: (id: string) => string; maxAttempts?: number } = {},
): Promise<{ id: string; file: string }> {
  await mkdir(dir, { recursive: true });
  const names = await readdir(dir);
  let n = Math.max(0, ...names.map((name) => idNumber(kind, name) ?? 0));
  const maxAttempts = options.maxAttempts ?? 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    n += 1;
    const id = formatId(kind, n);
    const file = path.join(dir, options.fileName ? options.fileName(id) : `${id}.md`);
    try {
      const handle = await open(file, 'wx');
      try {
        await handle.writeFile(render(id), 'utf8');
      } finally {
        await handle.close();
      }
      return { id, file };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not allocate a ${kind} id in ${dir} after ${maxAttempts} attempts`);
}

/** Appends one JSON line; small appends are atomic enough for logs shared by concurrent hooks. */
export async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

/** Replaces a file via a temp file + rename so readers never see a half-written file. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}
