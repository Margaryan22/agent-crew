// Tiny argument parser for `crew`: positionals, `--flag value`, `--flag=value`, repeated flags
// and boolean switches. Agents call the CLI through Bash, so errors must say exactly what to fix.

export class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {{ booleans?: string[] }} [options]
 */
export function parseArgs(argv, options = {}) {
  const booleans = new Set(options.booleans ?? []);
  /** @type {string[]} */
  const positional = [];
  /** @type {Map<string, (string | true)[]>} */
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      const eq = arg.indexOf('=');
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      let value;
      if (eq > 0) value = arg.slice(eq + 1);
      else if (booleans.has(name)) value = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
      else value = true;
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else {
      positional.push(arg);
    }
  }

  const used = new Set();
  return {
    positional,
    /** Last value of a string flag; throws when the flag was given without a value. */
    str(name) {
      used.add(name);
      const values = flags.get(name);
      if (!values) return undefined;
      const v = values[values.length - 1];
      if (v === true) throw new UsageError(`--${name} needs a value`);
      return v;
    },
    /** Every value of a repeatable flag. */
    all(name) {
      used.add(name);
      return (flags.get(name) ?? []).map((v) => {
        if (v === true) throw new UsageError(`--${name} needs a value`);
        return v;
      });
    },
    bool(name) {
      used.add(name);
      return flags.has(name);
    },
    /** Comma-separated list flag (`--depends-on T-001,T-002`), also accepted repeated. */
    list(name) {
      return this.all(name)
        .flatMap((v) => v.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
    },
    num(name) {
      const raw = this.str(name);
      if (raw === undefined) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, got "${raw}"`);
      return n;
    },
    /** Rejects flags the command does not know, so typos don't silently do nothing. */
    done() {
      const unknown = [...flags.keys()].filter((k) => !used.has(k));
      if (unknown.length) throw new UsageError(`unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.map((k) => `--${k}`).join(', ')}`);
    },
  };
}

/** `key=value` pairs for `crew task set` / `crew status set`; `key=` removes the key. */
export function parsePairs(words) {
  /** @type {Record<string, string | undefined>} */
  const out = {};
  for (const w of words) {
    const eq = w.indexOf('=');
    if (eq <= 0) throw new UsageError(`expected key=value, got "${w}"`);
    const value = w.slice(eq + 1);
    out[w.slice(0, eq).trim()] = value === '' ? undefined : value;
  }
  return out;
}
