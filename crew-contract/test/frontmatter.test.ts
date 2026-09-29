import { describe, expect, it } from 'vitest';
import { firstHeading, parseFrontmatter, parseScalar, renderFrontmatter, section, stringifyDocument, updateFrontmatter } from '../src/frontmatter';

describe('parseFrontmatter', () => {
  it('parses scalars, quotes, lists, block scalars and nested maps', () => {
    const text = [
      '---',
      'id: T-001',
      'title: "Login: form & validation"',
      "quote: 'it''s fine'",
      'attempts: 2',
      'ratio: 0.5',
      'draft: false',
      'done: true',
      'nothing: ~',
      'empty:',
      'files: [src/a.ts, "src/b, c.ts"]',
      'tags:',
      '  - one',
      '  - "two"',
      'checklist:',
      '  value: pass',
      '  risks: [a, b]',
      'notes: |',
      '  line one',
      '  line two',
      'folded: >',
      '  a',
      '  b',
      'comment: value # trailing comment',
      'not a key line',
      '---',
      '',
      '# Heading',
    ].join('\n');
    const fm = parseFrontmatter(text);
    expect(fm.hasFrontmatter).toBe(true);
    expect(fm.data).toEqual({
      id: 'T-001',
      title: 'Login: form & validation',
      quote: "it's fine",
      attempts: 2,
      ratio: 0.5,
      draft: false,
      done: true,
      nothing: null,
      empty: null,
      files: ['src/a.ts', 'src/b, c.ts'],
      tags: ['one', 'two'],
      checklist: { value: 'pass', risks: ['a', 'b'] },
      notes: 'line one\nline two',
      folded: 'a b',
      comment: 'value',
    });
    expect(fm.body).toBe('# Heading');
  });

  it('handles CRLF, BOM, "..." terminators and missing frontmatter', () => {
    expect(parseFrontmatter('\uFEFF---\r\nid: X\r\n---\r\nbody').data.id).toBe('X');
    expect(parseFrontmatter('---\nid: Y\n...\nrest').data.id).toBe('Y');
    expect(parseFrontmatter('---\nid: X\nno end').hasFrontmatter).toBe(false);
    expect(parseFrontmatter('plain').body).toBe('plain');
  });

  it('parseScalar falls back on broken JSON strings', () => {
    expect(parseScalar('"broken \\"')).toBe('broken \\');
    expect(parseScalar('-3')).toBe(-3);
    expect(parseScalar('null')).toBeNull();
  });
});

describe('writing', () => {
  it('renders plain, quoted, list and nested values and round-trips', () => {
    const data = {
      id: 'T-001',
      title: 'Payments: Stripe',
      flag: 'true',
      count: 3,
      ok: false,
      none: null,
      files: ['a.ts', 'b c.ts'],
      nums: [1, 2],
      map: { value: 'pass', list: ['x'] },
      skipped: undefined,
      trailing: 'space ',
    };
    const fm = renderFrontmatter(data);
    expect(fm).toContain('id: T-001');
    expect(fm).toContain('title: "Payments: Stripe"');
    expect(fm).toContain('flag: "true"');
    expect(fm).toContain('files: ["a.ts", "b c.ts"]');
    expect(fm).toContain('nums: [1, 2]');
    expect(fm).toContain('map:\n  value: pass\n  list: ["x"]');
    expect(fm).not.toContain('skipped');
    const { skipped: _skipped, ...expected } = data;
    expect(parseFrontmatter(stringifyDocument(data, 'Body')).data).toEqual(expected);
  });

  it('updateFrontmatter changes keys, keeps order and the body', () => {
    const text = '---\nid: E-1\nstatus: open\nnote: keep me\n---\n\n# Title\n\nBody text\n';
    const out = updateFrontmatter(text, { status: 'answered', note: undefined, answer: 'Yes' });
    expect(parseFrontmatter(out).data).toEqual({ id: 'E-1', status: 'answered', answer: 'Yes' });
    expect(out.endsWith('# Title\n\nBody text\n')).toBe(true);
    expect(updateFrontmatter('Just text', { a: 1 })).toBe('---\na: 1\n---\n\nJust text\n');
  });
});

describe('markdown helpers', () => {
  it('section stops at the next heading of the same level', () => {
    const body = '## A\n\none\n### nested\nstill A\n## B\n\n## C\ntext';
    expect(section(body, ['a'])).toBe('one\n### nested\nstill A');
    expect(section(body, ['B'])).toBeUndefined();
    expect(section(body, ['missing'])).toBeUndefined();
    expect(firstHeading('text\n# Title #\n')).toBe('Title');
  });
});
