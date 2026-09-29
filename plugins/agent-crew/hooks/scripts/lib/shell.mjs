// Best-effort POSIX shell parsing for policy checks. This is not a shell: it splits a command
// line into simple commands, unwraps common wrappers (env, sudo, sh -c, xargs, find -exec,
// eval) and marks anything it cannot resolve statically (variables, command substitution) as
// dynamic, so rules can fail closed on it.

/**
 * @typedef {{ text: string, dynamic: boolean }} Word
 * @typedef {{ op: string, target: Word }} Redirect
 * @typedef {{ argv: Word[], redirects: Redirect[], argsFromStdin?: boolean, via?: string, tainted?: boolean }} SimpleCommand
 */

const CONTROL = new Set(['&&', '||', ';', '|', '&', '\n', '(', ')', '|&']);

/** Tokenizes a script into words, control operators and redirections. Nested scripts from $(…)/`…` are returned separately. */
function tokenize(script) {
  /** @type {Array<{type:'word', word: Word} | {type:'op', value:string} | {type:'redir', op:string}>} */
  const tokens = [];
  /** @type {string[]} */
  const nested = [];
  let text = '';
  let dynamic = false;
  let inWord = false;
  const heredocs = [];
  let i = 0;

  const pushWord = () => {
    if (inWord) tokens.push({ type: 'word', word: { text, dynamic } });
    text = '';
    dynamic = false;
    inWord = false;
  };

  /** Reads a balanced $( … ) or ` … ` starting after the opener; returns [inner, nextIndex]. */
  const readSubstitution = (start, closer) => {
    let depth = 1;
    let j = start;
    let quote = '';
    while (j < script.length) {
      const c = script[j];
      if (quote) {
        if (c === '\\' && quote === '"') j++;
        else if (c === quote) quote = '';
      } else if (c === "'" || c === '"') {
        quote = c;
      } else if (c === '\\') {
        j++;
      } else if (closer === ')' && c === '(') {
        depth++;
      } else if (c === closer) {
        depth--;
        if (depth === 0) return [script.slice(start, j), j + 1];
      }
      j++;
    }
    return [script.slice(start), script.length];
  };

  const readDollar = () => {
    // at script[i] === '$'
    const next = script[i + 1];
    if (next === '(') {
      if (script[i + 2] === '(') {
        // $(( arithmetic )) — dynamic, not a command
        const [, end] = readSubstitution(i + 3, ')');
        i = end + 1;
      } else {
        const [inner, end] = readSubstitution(i + 2, ')');
        nested.push(inner);
        i = end;
      }
      dynamic = true;
      inWord = true;
      text += '$(…)';
      return;
    }
    if (next === '{') {
      const close = script.indexOf('}', i + 2);
      text += script.slice(i, close < 0 ? script.length : close + 1);
      i = close < 0 ? script.length : close + 1;
      dynamic = true;
      inWord = true;
      return;
    }
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(script.slice(i));
    if (m) {
      text += m[0];
      i += m[0].length;
      dynamic = true;
      inWord = true;
      return;
    }
    text += '$';
    inWord = true;
    i++;
  };

  while (i < script.length) {
    const c = script[i];

    if (c === "'") {
      const end = script.indexOf("'", i + 1);
      text += script.slice(i + 1, end < 0 ? script.length : end);
      inWord = true;
      i = end < 0 ? script.length : end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      inWord = true;
      while (i < script.length && script[i] !== '"') {
        if (script[i] === '\\' && i + 1 < script.length && '"\\$`\n'.includes(script[i + 1])) {
          text += script[i + 1];
          i += 2;
        } else if (script[i] === '$') {
          readDollar();
        } else if (script[i] === '`') {
          const [inner, end] = readSubstitution(i + 1, '`');
          nested.push(inner);
          text += '`…`';
          dynamic = true;
          i = end;
        } else {
          text += script[i++];
        }
      }
      i++;
      continue;
    }
    if (c === '\\') {
      if (script[i + 1] === '\n') {
        i += 2; // line continuation
        continue;
      }
      text += script[i + 1] ?? '';
      inWord = true;
      i += 2;
      continue;
    }
    if (c === '$') {
      readDollar();
      continue;
    }
    if (c === '`') {
      const [inner, end] = readSubstitution(i + 1, '`');
      nested.push(inner);
      text += '`…`';
      dynamic = true;
      inWord = true;
      i = end;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < script.length && script[i] !== '\n') i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      pushWord();
      i++;
      continue;
    }
    if (c === '\n') {
      pushWord();
      tokens.push({ type: 'op', value: '\n' });
      i++;
      // Skip heredoc bodies that start on the next line.
      while (heredocs.length) {
        const { delimiter, strip } = heredocs.shift();
        while (i < script.length) {
          const eol = script.indexOf('\n', i);
          const line = script.slice(i, eol < 0 ? script.length : eol);
          i = eol < 0 ? script.length : eol + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === delimiter) break;
        }
      }
      continue;
    }
    if (c === '>' || c === '<') {
      // A word made only of digits right before a redirection is a file descriptor.
      if (inWord && /^\d+$/.test(text) && !dynamic) {
        text = '';
        inWord = false;
      } else {
        pushWord();
      }
      let op = c;
      let j = i + 1;
      if (c === '<' && script[j] === '<') {
        op = '<<';
        j++;
        if (script[j] === '-') {
          op = '<<-';
          j++;
        } else if (script[j] === '<') {
          op = '<<<';
          j++;
        }
      } else if (script[j] === c || (c === '>' && script[j] === '|')) {
        op += script[j];
        j++;
      }
      if (script[j] === '&') {
        // >&2, <&0 — descriptor duplication, not a file
        j++;
        while (/[0-9-]/.test(script[j] ?? '')) j++;
        i = j;
        continue;
      }
      i = j;
      if (op === '<<' || op === '<<-') {
        // Read the delimiter word now; the body is skipped at the end of the line.
        while (script[i] === ' ' || script[i] === '\t') i++;
        let delimiter = '';
        while (i < script.length && !/[\s;&|<>()]/.test(script[i])) {
          if (script[i] === "'" || script[i] === '"') {
            const q = script[i];
            const end = script.indexOf(q, i + 1);
            delimiter += script.slice(i + 1, end < 0 ? script.length : end);
            i = end < 0 ? script.length : end + 1;
          } else {
            delimiter += script[i++];
          }
        }
        heredocs.push({ delimiter, strip: op === '<<-' });
        continue;
      }
      tokens.push({ type: 'redir', op });
      continue;
    }
    if (c === '&' && script[i + 1] === '>') {
      pushWord();
      const append = script[i + 2] === '>';
      tokens.push({ type: 'redir', op: append ? '&>>' : '&>' });
      i += append ? 3 : 2;
      continue;
    }
    const two = script.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '|&' || two === ';;') {
      pushWord();
      tokens.push({ type: 'op', value: two === ';;' ? ';' : two });
      i += 2;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      pushWord();
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    text += c;
    inWord = true;
    i++;
  }
  pushWord();
  return { tokens, nested };
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'in', 'case', 'esac', '{', '}', '!', 'function', 'select']);

export function basename(word) {
  return (word ?? '').split('/').pop() ?? '';
}

/** Splits leading `NAME=value` assignments off a command. */
function stripAssignments(argv) {
  let k = 0;
  while (k < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[k].text)) k++;
  return argv.slice(k);
}

/** Skips option words; `valueFlags` take the following word as their value. */
function skipOptions(argv, start, valueFlags = new Set()) {
  let k = start;
  while (k < argv.length && argv[k].text.startsWith('-') && argv[k].text !== '-') {
    if (argv[k].text === '--') return k + 1;
    if (valueFlags.has(argv[k].text)) k++;
    k++;
  }
  return k;
}

/**
 * Unwraps wrappers and returns the effective commands (one wrapper can yield several, e.g.
 * `sh -c 'a; b'`). `depth` stops runaway recursion.
 * @param {SimpleCommand} cmd
 * @returns {SimpleCommand[]}
 */
function unwrap(cmd, depth) {
  let argv = stripAssignments(cmd.argv);
  while (argv.length && KEYWORDS.has(argv[0].text)) argv = stripAssignments(argv.slice(1));
  // `> file` and `FOO=1 > file` run no command but still write through the redirect.
  if (!argv.length) return cmd.redirects.length ? [{ ...cmd, argv }] : [];
  const name = basename(argv[0].text);
  const next = (rest, via) => unwrap({ ...cmd, argv: rest, via: cmd.via ? `${cmd.via} ${via}` : via }, depth);

  switch (name) {
    case 'sudo':
      return next(argv.slice(skipOptions(argv, 1, new Set(['-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t']))), 'sudo');
    case 'env': {
      let k = skipOptions(argv, 1, new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']));
      while (k < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[k].text)) k++;
      return next(argv.slice(k), 'env');
    }
    case 'command':
    case 'builtin':
    case 'exec':
    case 'nohup':
    case 'time':
    case 'stdbuf':
    case 'ionice':
      return next(argv.slice(skipOptions(argv, 1, new Set(['-n', '-c', '-o', '-e', '-i']))), name);
    case 'nice':
      return next(argv.slice(skipOptions(argv, 1, new Set(['-n']))), 'nice');
    case 'timeout': {
      const k = skipOptions(argv, 1, new Set(['-s', '--signal', '-k', '--kill-after']));
      return next(argv.slice(k + 1), 'timeout');
    }
    case 'xargs': {
      const k = skipOptions(argv, 1, new Set(['-n', '-I', '-i', '-P', '-L', '-d', '-E', '-s', '-a', '--max-args', '--replace', '--max-procs', '--delimiter', '--arg-file']));
      return unwrap({ ...cmd, argv: argv.slice(k).length ? argv.slice(k) : [{ text: 'echo', dynamic: false }], argsFromStdin: true, via: 'xargs' }, depth);
    }
    case 'eval':
      if (depth > 5) return [{ ...cmd, argv }];
      return parseInto(argv.slice(1).map((w) => w.text).join(' '), depth + 1, argv.slice(1).some((w) => w.dynamic));
    default:
      break;
  }

  if (SHELLS.has(name)) {
    const c = argv.findIndex((w, idx) => idx > 0 && /^-[a-z]*c[a-z]*$/.test(w.text));
    if (c > 0 && argv[c + 1]) {
      if (depth > 5) return [{ ...cmd, argv }];
      return parseInto(argv[c + 1].text, depth + 1, argv[c + 1].dynamic);
    }
    return [{ ...cmd, argv }];
  }

  if (name === 'find') {
    const out = [{ ...cmd, argv }];
    for (let k = 1; k < argv.length; k++) {
      if (['-exec', '-execdir', '-ok', '-okdir'].includes(argv[k].text)) {
        const end = argv.findIndex((w, idx) => idx > k && (w.text === ';' || w.text === '+'));
        const inner = argv.slice(k + 1, end < 0 ? argv.length : end).map((w) => (w.text === '{}' ? { text: '{}', dynamic: true } : w));
        out.push(...unwrap({ argv: inner, redirects: [], via: 'find -exec' }, depth));
        if (end > 0) k = end;
      }
    }
    return out;
  }

  return [{ ...cmd, argv }];
}

/**
 * Parses an inner script (sh -c, eval). When the outer shell expands part of it first, the
 * commands are still checked by name, but their arguments and redirects count as unknown and
 * the commands are `tainted`, so they never get automatic approval.
 */
function parseInto(script, depth, forceDynamic = false) {
  const result = parseShell(script, depth);
  if (!forceDynamic) return result;
  const unknown = (w) => ({ ...w, dynamic: true });
  return result.map((c) => ({
    ...c,
    argv: c.argv.map((w, k) => (k === 0 ? w : unknown(w))),
    redirects: c.redirects.map((r) => ({ ...r, target: unknown(r.target) })),
    tainted: true,
  }));
}

/**
 * Parses a shell command line into the effective simple commands it runs.
 * @param {string} script
 * @returns {SimpleCommand[]}
 */
export function parseShell(script, depth = 0) {
  const { tokens, nested } = tokenize(script);
  /** @type {SimpleCommand[]} */
  const raw = [];
  let current = { argv: [], redirects: [] };
  const flush = () => {
    if (current.argv.length || current.redirects.length) raw.push(current);
    current = { argv: [], redirects: [] };
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'op') {
      if (CONTROL.has(t.value)) flush();
    } else if (t.type === 'redir') {
      const target = tokens[k + 1];
      if (target?.type === 'word') {
        current.redirects.push({ op: t.op, target: target.word });
        k++;
      }
    } else {
      current.argv.push(t.word);
    }
  }
  flush();

  const out = [];
  for (const cmd of raw) out.push(...unwrap(cmd, depth));
  for (const inner of nested) if (depth < 6) out.push(...parseShell(inner, depth + 1));
  return out;
}

/** Plain argv strings of a command (for prefix matching). */
export function argvText(cmd) {
  return cmd.argv.map((w) => w.text);
}
