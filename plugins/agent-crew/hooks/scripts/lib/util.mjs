// Small shared helpers: globs, paths, hashing, secret detection.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** `src/**`, `*.ts`, `drizzle.config.ts` → RegExp over posix relative paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(relPath, globs) {
  return globs.some((g) => globToRegExp(g).test(relPath));
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function expandHome(p, home = os.homedir()) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

/** Is `abs` equal to or inside `dir`? */
export function isInside(abs, dir) {
  const rel = path.relative(dir, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function digest(value, length = 24) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, length);
}

/** Temp locations agents may write outside the project (macOS tmpdir is a symlink, so both forms count). */
export function tempDirs(input) {
  const dirs = [os.tmpdir(), '/tmp', '/private/tmp', '/var/tmp'];
  if (input?.scratchpad_dir) dirs.push(input.scratchpad_dir);
  const out = new Set();
  for (const d of dirs) {
    out.add(path.resolve(d));
    try {
      out.add(realpathSync(d));
    } catch {
      // missing dirs only count by name
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Secrets

const ENV_FILE = /^\.env(\..+)?$/i;
const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist|defaults)$/i;

export function isEnvSecretFile(filePath) {
  const base = path.basename(filePath);
  return ENV_FILE.test(base) && !ENV_TEMPLATE.test(base);
}

const PLACEHOLDER = /^(|<.*>|\$\{.*\}|\$[A-Z_]+|changeme|change[-_]me|replace[-_]?me|your[-_].*|xx+|\*+|placeholder|example|dummy|todo|test|secret|password|none|null|false|true|\d{1,6})$/i;
const KNOWN_PREFIXES = /^(sk-[A-Za-z0-9_-]{16,}|sk_(live|test)_[A-Za-z0-9]{10,}|rk_(live|test)_[A-Za-z0-9]{10,}|pk_live_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|-----BEGIN)/;

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Does a .env value look like a real credential (not a placeholder or a local dev default)? */
export function looksLikeSecret(rawValue) {
  let value = rawValue.trim().replace(/\s+#.*$/, '');
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (PLACEHOLDER.test(value)) return false;
  if (KNOWN_PREFIXES.test(value)) return true;
  // Local dev URLs (docker compose defaults) are not secrets.
  if (/^[a-z][a-z0-9+.-]*:\/\/([^@/]*@)?(localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|\[::1\])(:\d+)?(\/|$)/i.test(value)) return false;
  // Credentials embedded in a remote URL.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:[^@/\s]{6,}@/i.test(value)) return true;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  return value.length >= 24 && classes >= 3 && entropy(value) >= 3.5;
}

/** Keys whose values look like real secrets in .env-style text. */
export function secretKeysIn(text) {
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && looksLikeSecret(m[2] ?? '')) keys.push(m[1]);
  }
  return keys;
}
