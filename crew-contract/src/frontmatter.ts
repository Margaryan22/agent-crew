// YAML-frontmatter subset used by .crew/ markdown files: scalars, quoted strings, inline and
// block lists, block scalars and one level of nested maps. Deliberately small and dependency
// free — the plugin's hooks bundle this module.

export type FmScalar = string | number | boolean | null;
export type FmValue = FmScalar | FmScalar[] | { [key: string]: FmScalar | FmScalar[] };
export type FmData = Record<string, FmValue>;

export interface ParsedFrontmatter {
  data: FmData;
  body: string;
  hasFrontmatter: boolean;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

function stripComment(raw: string): string {
  if (raw.startsWith('"') || raw.startsWith("'")) return raw;
  const idx = raw.search(/\s#/);
  return idx >= 0 ? raw.slice(0, idx).trimEnd() : raw;
}

export function parseScalar(raw: string): FmScalar {
  const value = stripComment(raw.trim());
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return unquote(value);
}

function splitInlineList(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') items.push(current);
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

function parseValue(rest: string): FmScalar | FmScalar[] {
  if (rest.startsWith('[') && rest.endsWith(']')) return splitInlineList(rest.slice(1, -1)).map(parseScalar);
  return parseScalar(rest);
}

const KEY_LINE = /^([A-Za-z_Ѐ-ӿ][\wЀ-ӿ -]*?)\s*:(?:\s+(.*)|\s*)$/;

export function parseFrontmatter(input: string): ParsedFrontmatter {
  const text = normalizeNewlines(input);
  if (!text.startsWith('---\n')) return { data: {}, body: text, hasFrontmatter: false };
  const lines = text.split('\n');
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { data: {}, body: text, hasFrontmatter: false };

  const data: FmData = {};
  const fm = lines.slice(1, end);
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i] ?? '';
    if (/^\s/.test(line)) continue;
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    const key = (match[1] ?? '').trim();
    const rest = (match[2] ?? '').trim();

    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const block: string[] = [];
      while (i + 1 < fm.length && (/^\s+/.test(fm[i + 1] ?? '') || (fm[i + 1] ?? '') === '')) {
        block.push((fm[++i] ?? '').replace(/^\s{1,4}/, ''));
      }
      data[key] = (rest.startsWith('|') ? block.join('\n') : block.join(' ').replace(/\s+/g, ' ')).trim();
      continue;
    }
    if (rest !== '') {
      data[key] = parseValue(rest);
      continue;
    }
    // Empty value: block list, nested map, or null.
    const next = fm[i + 1] ?? '';
    if (/^\s*-\s+/.test(next)) {
      const items: FmScalar[] = [];
      while (i + 1 < fm.length && /^\s*-\s+/.test(fm[i + 1] ?? '')) items.push(parseScalar((fm[++i] ?? '').replace(/^\s*-\s+/, '')));
      data[key] = items;
    } else if (/^\s+\S/.test(next) && KEY_LINE.test(next.trim())) {
      const map: { [k: string]: FmScalar | FmScalar[] } = {};
      while (i + 1 < fm.length && /^\s+\S/.test(fm[i + 1] ?? '')) {
        const m = KEY_LINE.exec((fm[++i] ?? '').trim());
        if (m) map[(m[1] ?? '').trim()] = parseValue((m[2] ?? '').trim());
      }
      data[key] = map;
    } else {
      data[key] = null;
    }
  }
  return { data, body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''), hasFrontmatter: true };
}

// ---------------------------------------------------------------------------
// Writing

const RESERVED = /^(true|false|null|~|-?\d+(\.\d+)?)$/;
const PLAIN = /^[\wЀ-ӿ][\wЀ-ӿ .,/@+()-]*$/;

function renderScalar(value: FmScalar): string {
  if (value === null) return 'null';
  if (typeof value !== 'string') return String(value);
  return PLAIN.test(value) && !RESERVED.test(value) && !value.endsWith(' ') ? value : JSON.stringify(value);
}

function renderValue(value: FmScalar | FmScalar[]): string {
  return Array.isArray(value) ? `[${value.map((v) => (typeof v === 'string' ? JSON.stringify(v) : renderScalar(v))).join(', ')}]` : renderScalar(value);
}

export function renderFrontmatter(data: Record<string, FmValue | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) if (v !== undefined) lines.push(`  ${k}: ${renderValue(v)}`);
    } else {
      lines.push(`${key}: ${renderValue(value)}`);
    }
  }
  return ['---', ...lines, '---'].join('\n');
}

export function stringifyDocument(data: Record<string, FmValue | undefined>, body: string): string {
  const cleanBody = normalizeNewlines(body).replace(/^\n+/, '').replace(/\n*$/, '\n');
  return `${renderFrontmatter(data)}\n\n${cleanBody}`;
}

/**
 * Sets (or with `undefined`, removes) frontmatter keys. Keeps every other key in its original
 * order and the body byte-for-byte; adds frontmatter when the document has none.
 */
export function updateFrontmatter(text: string, patch: Record<string, FmValue | undefined>): string {
  const parsed = parseFrontmatter(text);
  const data: Record<string, FmValue | undefined> = { ...parsed.data };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete data[key];
    else data[key] = value;
  }
  return stringifyDocument(data, parsed.body);
}

/** Markdown section body under `## <one of names>` until the next heading of the same or higher level. */
export function section(body: string, names: readonly string[]): string | undefined {
  const lines = body.split('\n');
  const wanted = names.map((n) => n.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,4})\s+(.+?)\s*:?\s*$/.exec(lines[i] ?? '');
    if (!m || !wanted.includes((m[2] ?? '').toLowerCase())) continue;
    const level = (m[1] ?? '').length;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = /^(#{1,6})\s/.exec(lines[j] ?? '');
      if (h && (h[1] ?? '').length <= level) break;
      out.push(lines[j] ?? '');
    }
    const text = out.join('\n').trim();
    return text === '' ? undefined : text;
  }
  return undefined;
}

export function firstHeading(body: string): string | undefined {
  return /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1]?.trim();
}
