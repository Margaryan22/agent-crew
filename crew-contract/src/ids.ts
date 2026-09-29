// Ids of tasks (T-001), escalations (E-001) and decisions (ADR-001).
// Several writers allocate ids (plugin agents, hooks, the host), so allocation is
// "highest existing + 1" and the file must be created exclusively (see node.ts).

export type IdKind = 'task' | 'escalation' | 'decision';

const PREFIX: Record<IdKind, string> = { task: 'T', escalation: 'E', decision: 'ADR' };

export const ID_PATTERNS: Record<IdKind, RegExp> = {
  task: /^T-\d{3,}$/,
  escalation: /^E-\d{3,}$/,
  decision: /^ADR-\d{3,}$/,
};

/** Number part of an id or of a file name that starts with one (`ADR-004-stack.md` → 4). */
export function idNumber(kind: IdKind, idOrFileName: string): number | undefined {
  const m = new RegExp(`^${PREFIX[kind]}-(\\d+)`, 'i').exec(idOrFileName);
  return m ? Number(m[1]) : undefined;
}

/** `ADR-001-use-tanstack.md` → `ADR-001`, `T-007.md` → `T-007`. */
export function idFromFileName(kind: IdKind, fileName: string): string | undefined {
  const n = idNumber(kind, fileName);
  return n === undefined ? undefined : formatId(kind, n);
}

export function formatId(kind: IdKind, n: number): string {
  return `${PREFIX[kind]}-${String(n).padStart(3, '0')}`;
}

export function nextId(kind: IdKind, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const n = idNumber(kind, id);
    if (n !== undefined && n > max) max = n;
  }
  return formatId(kind, max + 1);
}
