// License module — OFF by default (LICENSE_MODULE_ENABLED). When turned on (and package.json
// "pricing" set to "Trial"), Free allows one active project and the tanstack stack profile;
// Pro removes both limits. Keys live in SecretStorage and are validated through a
// LicenseProvider (Polar or Lemon Squeezy); results are cached for 7 days and the cache is used
// when offline. Checks run only when a session starts — a running session is never blocked.

import { createHash } from 'node:crypto';

export const LICENSE_MODULE_ENABLED = false;

export type Plan = 'free' | 'pro' | 'unrestricted';

export interface Entitlements {
  plan: Plan;
  maxActiveProjects: number;
  /** Allowed stack profiles; 'all' for every profile. */
  stackProfiles: 'all' | readonly string[];
  priorityUpdates: boolean;
}

export const FREE: Entitlements = { plan: 'free', maxActiveProjects: 1, stackProfiles: ['tanstack'], priorityUpdates: false };
export const PRO: Entitlements = { plan: 'pro', maxActiveProjects: Number.POSITIVE_INFINITY, stackProfiles: 'all', priorityUpdates: true };
/** Used while the license module is disabled. */
export const UNRESTRICTED: Entitlements = { ...PRO, plan: 'unrestricted', priorityUpdates: false };

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVE_PROJECT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Providers

export interface LicenseValidation {
  valid: boolean;
  expiresAt?: string;
  reason?: string;
}

/** The provider could not be reached (network error, 5xx, rate limit) — fall back to the cache. */
export class LicenseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseUnavailableError';
  }
}

export interface LicenseProvider {
  readonly name: string;
  validate(key: string, signal?: AbortSignal): Promise<LicenseValidation>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: string, signal?: AbortSignal) {
  try {
    return await fetchImpl(url, { method: 'POST', headers, body, ...(signal ? { signal } : {}) });
  } catch (err) {
    throw new LicenseUnavailableError(`License server unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isExpired(expiresAt: unknown, now: number): boolean {
  if (typeof expiresAt !== 'string') return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now;
}

/** Polar customer-portal validation (public endpoint, no token). */
export class PolarLicenseProvider implements LicenseProvider {
  readonly name = 'polar';

  constructor(
    private readonly organizationId: string,
    private readonly fetchImpl: FetchLike,
    private readonly baseUrl = 'https://api.polar.sh',
    private readonly now: () => number = Date.now,
  ) {}

  async validate(key: string, signal?: AbortSignal): Promise<LicenseValidation> {
    const res = await post(
      this.fetchImpl,
      `${this.baseUrl}/v1/customer-portal/license-keys/validate`,
      { 'Content-Type': 'application/json', Accept: 'application/json' },
      JSON.stringify({ key, organization_id: this.organizationId }),
      signal,
    );
    if (res.status === 404 || res.status === 422 || res.status === 400) return { valid: false, reason: 'License key not found or not active' };
    if (!res.ok) throw new LicenseUnavailableError(`Polar returned HTTP ${res.status}`);
    const data = (await res.json()) as { status?: string; expires_at?: string | null };
    if (data.status !== 'granted') return { valid: false, reason: `License status: ${data.status ?? 'unknown'}` };
    if (isExpired(data.expires_at, this.now())) return { valid: false, reason: 'License expired' };
    return data.expires_at ? { valid: true, expiresAt: data.expires_at } : { valid: true };
  }
}

/** Lemon Squeezy License API validation. */
export class LemonSqueezyLicenseProvider implements LicenseProvider {
  readonly name = 'lemonsqueezy';

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly expected: { storeId?: number; productId?: number } = {},
    private readonly baseUrl = 'https://api.lemonsqueezy.com',
  ) {}

  async validate(key: string, signal?: AbortSignal): Promise<LicenseValidation> {
    const res = await post(
      this.fetchImpl,
      `${this.baseUrl}/v1/licenses/validate`,
      { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      new URLSearchParams({ license_key: key }).toString(),
      signal,
    );
    if (res.status >= 500 || res.status === 429) throw new LicenseUnavailableError(`Lemon Squeezy returned HTTP ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as {
      valid?: boolean;
      error?: string | null;
      license_key?: { status?: string; expires_at?: string | null };
      meta?: { store_id?: number; product_id?: number };
    };
    if (!data.valid) return { valid: false, reason: data.error ?? 'License key is not valid' };
    if (this.expected.storeId !== undefined && data.meta?.store_id !== this.expected.storeId) return { valid: false, reason: 'License belongs to another store' };
    if (this.expected.productId !== undefined && data.meta?.product_id !== this.expected.productId) return { valid: false, reason: 'License belongs to another product' };
    const status = data.license_key?.status;
    if (status && status !== 'active' && status !== 'inactive') return { valid: false, reason: `License status: ${status}` };
    const expiresAt = data.license_key?.expires_at;
    return expiresAt ? { valid: true, expiresAt } : { valid: true };
  }
}

export type LicenseProviderConfig =
  | { kind: 'polar'; organizationId: string }
  | { kind: 'lemonsqueezy'; storeId?: number; productId?: number };

/** Fill in before enabling the module (see NOTES.md). */
export const LICENSE_PROVIDER_CONFIG: LicenseProviderConfig = { kind: 'polar', organizationId: '' };

export function createLicenseProvider(config: LicenseProviderConfig, fetchImpl: FetchLike): LicenseProvider {
  if (config.kind === 'polar') return new PolarLicenseProvider(config.organizationId, fetchImpl);
  const expected: { storeId?: number; productId?: number } = {};
  if (config.storeId !== undefined) expected.storeId = config.storeId;
  if (config.productId !== undefined) expected.productId = config.productId;
  return new LemonSqueezyLicenseProvider(fetchImpl, expected);
}

// ---------------------------------------------------------------------------
// Service

export interface LicenseCache {
  keyFingerprint: string;
  valid: boolean;
  checkedAt: number;
  expiresAt?: string;
  reason?: string;
}

export interface LicenseStorage {
  getKey(): Promise<string | undefined>;
  setKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
  getCache(): LicenseCache | undefined;
  setCache(cache: LicenseCache | undefined): Promise<void>;
}

export function fingerprint(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex').slice(0, 32);
}

export interface EnterKeyResult {
  ok: boolean;
  entitlements: Entitlements;
  message: string;
}

export interface StartCheck {
  allowed: boolean;
  reason?: string;
}

export class LicenseService {
  private readonly enabled: boolean;
  private readonly now: () => number;

  constructor(
    private readonly provider: LicenseProvider,
    private readonly storage: LicenseStorage,
    options: { enabled?: boolean; now?: () => number } = {},
  ) {
    this.enabled = options.enabled ?? LICENSE_MODULE_ENABLED;
    this.now = options.now ?? Date.now;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async entitlements(): Promise<Entitlements> {
    if (!this.enabled) return UNRESTRICTED;
    const key = await this.storage.getKey();
    if (!key) return FREE;
    const fp = fingerprint(key);
    const cache = this.storage.getCache();
    const cacheMatches = cache?.keyFingerprint === fp;
    if (cache && cacheMatches && this.now() - cache.checkedAt < CACHE_TTL_MS) return this.fromCache(cache);
    try {
      const result = await this.provider.validate(key);
      const fresh = this.toCache(fp, result);
      await this.storage.setCache(fresh);
      return this.fromCache(fresh);
    } catch (err) {
      if (err instanceof LicenseUnavailableError && cache && cacheMatches) return this.fromCache(cache);
      return FREE;
    }
  }

  async enterKey(rawKey: string): Promise<EnterKeyResult> {
    const key = rawKey.trim();
    if (!key) return { ok: false, entitlements: FREE, message: 'The license key is empty.' };
    try {
      const result = await this.provider.validate(key);
      if (!result.valid) return { ok: false, entitlements: await this.entitlements(), message: result.reason ?? 'The license key is not valid.' };
      await this.storage.setKey(key);
      await this.storage.setCache(this.toCache(fingerprint(key), result));
      return { ok: true, entitlements: PRO, message: 'Agent Crew Pro is active.' };
    } catch (err) {
      if (!(err instanceof LicenseUnavailableError)) throw err;
      await this.storage.setKey(key);
      await this.storage.setCache(undefined);
      return { ok: true, entitlements: FREE, message: 'The license server is unreachable; the key is saved and will be verified when you are online.' };
    }
  }

  async clear(): Promise<void> {
    await this.storage.deleteKey();
    await this.storage.setCache(undefined);
  }

  /** Called only when a session starts; never while one is running. */
  checkStart(entitlements: Entitlements, request: { project: string; activeProjects: string[]; stackProfile: string }): StartCheck {
    if (!this.enabled) return { allowed: true };
    if (entitlements.stackProfiles !== 'all' && !entitlements.stackProfiles.includes(request.stackProfile)) {
      return { allowed: false, reason: `The "${request.stackProfile}" stack profile needs Agent Crew Pro.` };
    }
    const others = request.activeProjects.filter((p) => p !== request.project);
    if (others.length >= entitlements.maxActiveProjects) {
      return {
        allowed: false,
        reason: `The Free plan allows ${entitlements.maxActiveProjects} active project (${others.join(', ')} is active). Stop it with "Crew: Stop" or upgrade to Pro.`,
      };
    }
    return { allowed: true };
  }

  private toCache(fp: string, result: LicenseValidation): LicenseCache {
    const cache: LicenseCache = { keyFingerprint: fp, valid: result.valid, checkedAt: this.now() };
    if (result.expiresAt) cache.expiresAt = result.expiresAt;
    if (result.reason) cache.reason = result.reason;
    return cache;
  }

  private fromCache(cache: LicenseCache): Entitlements {
    if (!cache.valid) return FREE;
    if (isExpired(cache.expiresAt, this.now())) return FREE;
    return PRO;
  }
}

// ---------------------------------------------------------------------------
// Active projects (across windows, kept in globalState)

export type ProjectState = 'active' | 'stopped';
export type ProjectRegistryData = Record<string, { state: ProjectState; updatedAt: number }>;

export function activeProjects(data: ProjectRegistryData, now: number): string[] {
  return Object.entries(data)
    .filter(([, v]) => v.state === 'active' && now - v.updatedAt < ACTIVE_PROJECT_WINDOW_MS)
    .map(([path]) => path);
}

export function markProject(data: ProjectRegistryData, project: string, state: ProjectState, now: number): ProjectRegistryData {
  return { ...data, [project]: { state, updatedAt: now } };
}
