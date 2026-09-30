import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CrewReader } from '../../src/crew/snapshot';

/** A CrewReader over an in-memory map of workspace-relative paths. */
export function memoryReader(files: Record<string, string>): CrewReader {
  const paths = Object.keys(files);
  return {
    list: (dir) => Promise.resolve([...new Set(paths.filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)))]),
    read: (p) => Promise.resolve(files[p]),
    exists: (p) => Promise.resolve(paths.some((x) => x === p || x.startsWith(`${p}/`))),
  };
}

/** Loads a directory tree into the map, with paths relative to `base`. */
export function loadTree(base: string, dir = base, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) loadTree(base, abs, out);
    else out[path.relative(base, abs).split(path.sep).join('/')] = readFileSync(abs, 'utf8');
  }
  return out;
}
