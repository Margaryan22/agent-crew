// npm registry vetting for packages outside the stack profile's allowlist (SPEC §9): the
// package must exist, be at least `minAgeDays` old and have at least `minWeeklyDownloads`.
// Results are cached in the plugin's data directory; network failures fail closed.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OK_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function encodeName(name) {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

/**
 * @param {{ fetch?: typeof fetch, cacheFile?: string, now?: () => number, packages: { registryUrl: string, downloadsUrl: string, minAgeDays: number, minWeeklyDownloads: number, timeoutMs: number } }} options
 */
export function createRegistryChecker(options) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cfg = options.packages;
  let cache = {};
  if (options.cacheFile) {
    try {
      cache = JSON.parse(readFileSync(options.cacheFile, 'utf8'));
    } catch {
      cache = {};
    }
  }

  const save = () => {
    if (!options.cacheFile) return;
    try {
      mkdirSync(path.dirname(options.cacheFile), { recursive: true });
      writeFileSync(options.cacheFile, JSON.stringify(cache));
    } catch {
      // the cache is an optimisation only
    }
  };

  const getJson = async (url) => {
    const res = await doFetch(url, { signal: AbortSignal.timeout(cfg.timeoutMs), headers: { accept: 'application/json' } });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  };

  /** @returns {Promise<{ ok: boolean, reason?: string }>} */
  return async function check(name) {
    const cached = cache[name];
    if (cached && now() - cached.checkedAt < (cached.ok ? OK_TTL_MS : FAIL_TTL_MS)) return { ok: cached.ok, ...(cached.reason ? { reason: cached.reason } : {}) };

    let result;
    try {
      const meta = await getJson(`${cfg.registryUrl}/${encodeName(name)}`);
      if (!meta) {
        result = { ok: false, reason: `package "${name}" does not exist in the npm registry` };
      } else {
        const created = Date.parse(meta.time?.created ?? '');
        const ageDays = Number.isFinite(created) ? Math.floor((now() - created) / DAY_MS) : 0;
        if (ageDays < cfg.minAgeDays) {
          result = { ok: false, reason: `package "${name}" is only ${ageDays} day(s) old (minimum ${cfg.minAgeDays})` };
        } else {
          const downloads = (await getJson(`${cfg.downloadsUrl}/${encodeName(name)}`))?.downloads ?? 0;
          result =
            downloads < cfg.minWeeklyDownloads
              ? { ok: false, reason: `package "${name}" has ${downloads} weekly downloads (minimum ${cfg.minWeeklyDownloads})` }
              : { ok: true };
        }
      }
    } catch (err) {
      // Not cached: a transient network problem should not stick.
      return { ok: false, reason: `could not verify package "${name}" in the npm registry (${err instanceof Error ? err.message : String(err)})` };
    }
    cache[name] = { ...result, checkedAt: now() };
    save();
    return result;
  };
}
