import { describe, expect, it, vi } from 'vitest';
import {
  activeProjects,
  CACHE_TTL_MS,
  createLicenseProvider,
  type FetchLike,
  fingerprint,
  FREE,
  LemonSqueezyLicenseProvider,
  LICENSE_MODULE_ENABLED,
  type LicenseCache,
  type LicenseProvider,
  LicenseService,
  type LicenseStorage,
  LicenseUnavailableError,
  markProject,
  PolarLicenseProvider,
  PRO,
  UNRESTRICTED,
} from '../../src/license';

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function memoryStorage(key?: string, cache?: LicenseCache): LicenseStorage & { key?: string; cache?: LicenseCache } {
  const s = {
    key,
    cache,
    getKey: () => Promise.resolve(s.key),
    setKey: (k: string) => {
      s.key = k;
      return Promise.resolve();
    },
    deleteKey: () => {
      s.key = undefined;
      return Promise.resolve();
    },
    getCache: () => s.cache,
    setCache: (c: LicenseCache | undefined) => {
      s.cache = c;
      return Promise.resolve();
    },
  };
  return s;
}

function provider(impl: LicenseProvider['validate']): LicenseProvider & { calls: number } {
  const p = {
    name: 'fake',
    calls: 0,
    validate: (key: string) => {
      p.calls++;
      return impl(key);
    },
  };
  return p;
}

const NOW = Date.parse('2026-09-26T10:00:00Z');

describe('license module defaults', () => {
  it('is disabled by default and then imposes no limits', async () => {
    expect(LICENSE_MODULE_ENABLED).toBe(false);
    const service = new LicenseService(provider(() => Promise.resolve({ valid: false })), memoryStorage());
    expect(service.isEnabled).toBe(false);
    expect(await service.entitlements()).toBe(UNRESTRICTED);
    expect(service.checkStart(FREE, { project: '/b', activeProjects: ['/a'], stackProfile: 'nextjs' })).toEqual({ allowed: true });
  });
});

describe('LicenseService (enabled)', () => {
  const opts = { enabled: true, now: () => NOW };

  it('is Free without a key', async () => {
    const p = provider(() => Promise.resolve({ valid: true }));
    expect(await new LicenseService(p, memoryStorage(), opts).entitlements()).toBe(FREE);
    expect(p.calls).toBe(0);
  });

  it('validates online, caches for 7 days and revalidates afterwards', async () => {
    const storage = memoryStorage('KEY-1');
    let clock = NOW;
    const p = provider(() => Promise.resolve({ valid: true, expiresAt: '2027-01-01T00:00:00Z' }));
    const service = new LicenseService(p, storage, { enabled: true, now: () => clock });
    expect(await service.entitlements()).toBe(PRO);
    expect(storage.cache).toMatchObject({ keyFingerprint: fingerprint('KEY-1'), valid: true, checkedAt: NOW, expiresAt: '2027-01-01T00:00:00Z' });
    clock = NOW + CACHE_TTL_MS - 1;
    expect(await service.entitlements()).toBe(PRO);
    expect(p.calls).toBe(1);
    clock = NOW + CACHE_TTL_MS + 1;
    expect(await service.entitlements()).toBe(PRO);
    expect(p.calls).toBe(2);
  });

  it('works from a stale cache when offline and falls back to Free without one', async () => {
    const offline = provider(() => Promise.reject(new LicenseUnavailableError('offline')));
    const stale: LicenseCache = { keyFingerprint: fingerprint('KEY'), valid: true, checkedAt: NOW - 30 * CACHE_TTL_MS };
    expect(await new LicenseService(offline, memoryStorage('KEY', stale), opts).entitlements()).toBe(PRO);
    expect(await new LicenseService(offline, memoryStorage('KEY'), opts).entitlements()).toBe(FREE);
    // Cache of a different key is not used
    expect(await new LicenseService(offline, memoryStorage('OTHER', stale), opts).entitlements()).toBe(FREE);
    // Unexpected errors → Free
    const broken = provider(() => Promise.reject(new Error('bug')));
    expect(await new LicenseService(broken, memoryStorage('KEY'), opts).entitlements()).toBe(FREE);
  });

  it('treats invalid or expired cached licenses as Free', async () => {
    const invalid: LicenseCache = { keyFingerprint: fingerprint('KEY'), valid: false, checkedAt: NOW, reason: 'revoked' };
    expect(await new LicenseService(provider(() => Promise.resolve({ valid: true })), memoryStorage('KEY', invalid), opts).entitlements()).toBe(FREE);
    const expired: LicenseCache = { keyFingerprint: fingerprint('KEY'), valid: true, checkedAt: NOW, expiresAt: '2026-01-01T00:00:00Z' };
    expect(await new LicenseService(provider(() => Promise.resolve({ valid: true })), memoryStorage('KEY', expired), opts).entitlements()).toBe(FREE);
  });

  it('enterKey stores valid keys only and keeps offline keys for later', async () => {
    const storage = memoryStorage();
    const ok = await new LicenseService(provider(() => Promise.resolve({ valid: true })), storage, opts).enterKey('  PRO-KEY  ');
    expect(ok).toMatchObject({ ok: true, entitlements: PRO });
    expect(storage.key).toBe('PRO-KEY');

    const rejected = memoryStorage();
    const bad = await new LicenseService(provider(() => Promise.resolve({ valid: false, reason: 'Revoked' })), rejected, opts).enterKey('BAD');
    expect(bad).toMatchObject({ ok: false, message: 'Revoked' });
    expect(rejected.key).toBeUndefined();

    const noReason = await new LicenseService(provider(() => Promise.resolve({ valid: false })), memoryStorage(), opts).enterKey('BAD');
    expect(noReason.message).toBe('The license key is not valid.');

    const offlineStorage = memoryStorage(undefined, { keyFingerprint: 'x', valid: true, checkedAt: NOW });
    const offline = await new LicenseService(provider(() => Promise.reject(new LicenseUnavailableError('down'))), offlineStorage, opts).enterKey('LATER');
    expect(offline).toMatchObject({ ok: true, entitlements: FREE });
    expect(offlineStorage.key).toBe('LATER');
    expect(offlineStorage.cache).toBeUndefined();

    expect((await new LicenseService(provider(() => Promise.resolve({ valid: true })), memoryStorage(), opts).enterKey('   ')).ok).toBe(false);
    await expect(new LicenseService(provider(() => Promise.reject(new Error('bug'))), memoryStorage(), opts).enterKey('K')).rejects.toThrow('bug');
  });

  it('clear removes the key and cache', async () => {
    const storage = memoryStorage('K', { keyFingerprint: 'f', valid: true, checkedAt: NOW });
    await new LicenseService(provider(() => Promise.resolve({ valid: true })), storage, opts).clear();
    expect(storage.key).toBeUndefined();
    expect(storage.cache).toBeUndefined();
  });

  it('Free allows one active project and the tanstack profile; Pro allows everything', () => {
    const service = new LicenseService(provider(() => Promise.resolve({ valid: true })), memoryStorage(), opts);
    expect(service.checkStart(FREE, { project: '/a', activeProjects: [], stackProfile: 'tanstack' })).toEqual({ allowed: true });
    expect(service.checkStart(FREE, { project: '/a', activeProjects: ['/a'], stackProfile: 'tanstack' })).toEqual({ allowed: true });
    const second = service.checkStart(FREE, { project: '/b', activeProjects: ['/a'], stackProfile: 'tanstack' });
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain('/a');
    expect(service.checkStart(FREE, { project: '/a', activeProjects: [], stackProfile: 'nextjs' }).allowed).toBe(false);
    expect(service.checkStart(PRO, { project: '/c', activeProjects: ['/a', '/b'], stackProfile: 'nextjs' })).toEqual({ allowed: true });
  });
});

describe('PolarLicenseProvider', () => {
  it('posts the key and organization and maps responses', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(response(200, { status: 'granted', expires_at: '2027-01-01T00:00:00Z' }));
    const polar = new PolarLicenseProvider('org-1', fetchImpl, 'https://api.polar.test', () => NOW);
    expect(await polar.validate('KEY')).toEqual({ valid: true, expiresAt: '2027-01-01T00:00:00Z' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.polar.test/v1/customer-portal/license-keys/validate');
    expect(JSON.parse(init.body)).toEqual({ key: 'KEY', organization_id: 'org-1' });

    fetchImpl.mockResolvedValueOnce(response(200, { status: 'granted', expires_at: null }));
    expect(await polar.validate('KEY')).toEqual({ valid: true });
    fetchImpl.mockResolvedValueOnce(response(200, { status: 'granted', expires_at: '2026-01-01T00:00:00Z' }));
    expect(await polar.validate('KEY')).toMatchObject({ valid: false, reason: 'License expired' });
    fetchImpl.mockResolvedValueOnce(response(200, { status: 'revoked' }));
    expect((await polar.validate('KEY')).valid).toBe(false);
    fetchImpl.mockResolvedValueOnce(response(404, {}));
    expect((await polar.validate('KEY')).valid).toBe(false);
    fetchImpl.mockResolvedValueOnce(response(503, {}));
    await expect(polar.validate('KEY')).rejects.toBeInstanceOf(LicenseUnavailableError);
    fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(polar.validate('KEY')).rejects.toBeInstanceOf(LicenseUnavailableError);
    fetchImpl.mockRejectedValueOnce('string failure');
    await expect(polar.validate('KEY')).rejects.toThrow('string failure');
  });
});

describe('LemonSqueezyLicenseProvider', () => {
  it('posts form data and checks store, product and status', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      response(200, { valid: true, license_key: { status: 'active', expires_at: '2027-01-01' }, meta: { store_id: 1, product_id: 2 } }),
    );
    const lemon = new LemonSqueezyLicenseProvider(fetchImpl, { storeId: 1, productId: 2 }, 'https://api.lemon.test');
    expect(await lemon.validate('K 1')).toEqual({ valid: true, expiresAt: '2027-01-01' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.lemon.test/v1/licenses/validate');
    expect(init.body).toBe('license_key=K+1');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    fetchImpl.mockResolvedValueOnce(response(200, { valid: true, license_key: { status: 'active' }, meta: { store_id: 9, product_id: 2 } }));
    expect(await lemon.validate('K')).toMatchObject({ valid: false, reason: 'License belongs to another store' });
    fetchImpl.mockResolvedValueOnce(response(200, { valid: true, license_key: { status: 'active' }, meta: { store_id: 1, product_id: 9 } }));
    expect(await lemon.validate('K')).toMatchObject({ valid: false, reason: 'License belongs to another product' });
    fetchImpl.mockResolvedValueOnce(response(200, { valid: true, license_key: { status: 'disabled' }, meta: { store_id: 1, product_id: 2 } }));
    expect(await lemon.validate('K')).toMatchObject({ valid: false, reason: 'License status: disabled' });
    fetchImpl.mockResolvedValueOnce(response(400, { valid: false, error: 'license_key not found.' }));
    expect(await lemon.validate('K')).toEqual({ valid: false, reason: 'license_key not found.' });
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.reject(new Error('not json')) });
    expect(await lemon.validate('K')).toEqual({ valid: false, reason: 'License key is not valid' });
    fetchImpl.mockResolvedValueOnce(response(429, {}));
    await expect(lemon.validate('K')).rejects.toBeInstanceOf(LicenseUnavailableError);

    const any = new LemonSqueezyLicenseProvider(vi.fn<FetchLike>().mockResolvedValue(response(200, { valid: true, license_key: { status: 'inactive' } })));
    expect(await any.validate('K')).toEqual({ valid: true });
  });
});

describe('createLicenseProvider', () => {
  it('builds the configured provider', () => {
    const f = vi.fn<FetchLike>();
    expect(createLicenseProvider({ kind: 'polar', organizationId: 'o' }, f).name).toBe('polar');
    expect(createLicenseProvider({ kind: 'lemonsqueezy', storeId: 1, productId: 2 }, f).name).toBe('lemonsqueezy');
    expect(createLicenseProvider({ kind: 'lemonsqueezy' }, f).name).toBe('lemonsqueezy');
  });
});

describe('project registry', () => {
  it('counts recently active projects only', () => {
    let data = markProject({}, '/a', 'active', NOW);
    data = markProject(data, '/b', 'stopped', NOW);
    data = markProject(data, '/c', 'active', NOW - 30 * 24 * 3600 * 1000);
    expect(activeProjects(data, NOW)).toEqual(['/a']);
  });
});
